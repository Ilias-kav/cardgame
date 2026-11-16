import {
  applyAction,
  err,
  ok,
  otherPlayer,
  type Action,
  type CardCatalog,
  type GameEvent,
  type GameResult,
  type GameState,
  type PlayerIndex,
  type Result,
} from '@cardgame/engine';
import type { Clock } from './clock.js';
import type { ServerMessage } from './protocol.js';
import type { GameStore } from './store.js';
import type { GameRecord, Outcome } from './types.js';
import { viewFor } from './view.js';

export interface RoomDeps {
  catalog: CardCatalog;
  store: GameStore;
  clock: Clock;
  send(userId: string, message: ServerMessage): void;
  /** Time to finish a turn (or setup, or a promotion) before losing. */
  turnTimeoutMs: number;
  /** Time a disconnected player has to come back before forfeiting. */
  disconnectGraceMs: number;
  randomSeed(): number;
  log(message: string, error?: unknown): void;
  /** Called once when the game is over; `rematch` is the new game after a sudden-death tie. */
  onFinished(room: GameRoom, rematch: GameRecord | null): void;
}

export function outcomeFromResult(result: GameResult): Outcome {
  return result.winner === null
    ? { winner: null, reason: 'sudden_death_rematch' }
    : { winner: result.winner, reason: result.reason };
}

/** The players the game is currently waiting for. */
export function actorsFor(state: GameState): PlayerIndex[] {
  if (state.phase === 'setup' && state.setup) {
    return ([0, 1] as const).filter((p) => !state.setup!.placed[p]);
  }
  if (state.phase !== 'playing') return [];
  if (state.pendingDecisions.length > 0) {
    return [...new Set(state.pendingDecisions.map((d) => d.player))];
  }
  return [state.currentPlayer];
}

function signatureOf(state: GameState): string {
  return [
    state.phase,
    state.turn,
    state.turnStage,
    state.pendingDecisions.map((d) => d.player).join(','),
    state.setup ? `${state.setup.placed.join(',')}/${state.setup.extraDrawResolved.join(',')}` : '',
  ].join('|');
}

/**
 * One running game on the server. All changes go through a queue, so two
 * simultaneous requests can never interleave; every accepted action is saved
 * BEFORE it takes effect, so the game can always be rebuilt after a crash.
 */
export class GameRoom {
  state: GameState;
  seq: number;
  outcome: Outcome | null = null;
  /** When the current actor(s) run out of time (epoch ms), or null. */
  deadline: number | null = null;

  private chain: Promise<unknown> = Promise.resolve();
  private turnTimer: unknown = null;
  private signature = '';
  private graceTimers: [unknown, unknown] = [null, null];
  private connected: [boolean, boolean];

  constructor(
    private readonly deps: RoomDeps,
    readonly record: GameRecord,
    state: GameState,
    seq: number,
    connected: [boolean, boolean],
  ) {
    this.state = state;
    this.seq = seq;
    this.connected = connected;
  }

  get id(): string {
    return this.record.id;
  }

  seatOf(userId: string): PlayerIndex | null {
    return this.record.players.find((p) => p.userId === userId)?.seat ?? null;
  }

  userOf(seat: PlayerIndex): string {
    const p = this.record.players.find((x) => x.seat === seat);
    if (!p) throw new Error(`No player in seat ${seat}`);
    return p.userId;
  }

  usernameOf(seat: PlayerIndex): string {
    return this.record.players.find((x) => x.seat === seat)?.username ?? '?';
  }

  /** Starts timers (and finishes right away if a recovered game had already ended). */
  start(): void {
    if (this.state.phase === 'finished' && this.state.result) {
      const outcome = outcomeFromResult(this.state.result);
      void this.enqueue(() => this.finish(outcome));
      return;
    }
    this.refreshTimers();
    for (const seat of [0, 1] as const) if (!this.connected[seat]) this.startGrace(seat);
  }

  /** Tells both players the game began, with the opening events (coin flip, mulligans). */
  announce(openingEvents: GameEvent[]): void {
    for (const seat of [0, 1] as const) {
      this.deps.send(this.userOf(seat), {
        type: 'game.started',
        gameId: this.id,
        seat,
        opponent: this.usernameOf(otherPlayer(seat)),
        rematchOf: this.record.rematchOf,
      });
    }
    this.broadcastUpdate(openingEvents);
  }

  stateMessage(seat: PlayerIndex): ServerMessage {
    return {
      type: 'game.state',
      gameId: this.id,
      seq: this.seq,
      deadline: this.deadline,
      view: viewFor(this.state, seat, this.outcome),
    };
  }

  /** A player asks to do something. Resolves with the engine's verdict. */
  submit(userId: string, action: Action): Promise<Result<void>> {
    return this.enqueue(async () => {
      if (this.outcome) return err('GAME_OVER', 'The game is over');
      const seat = this.seatOf(userId);
      if (seat === null) return err('NOT_A_PLAYER', 'You are not part of this game');

      const result = applyAction(this.deps.catalog, this.state, seat, action);
      if (!result.ok) return err(result.error.code, result.error.message);

      try {
        await this.deps.store.appendAction(this.id, this.seq + 1, seat, action);
      } catch (error) {
        this.deps.log(`Could not save action for game ${this.id}`, error);
        return err('PERSISTENCE_FAILED', 'Your move could not be saved. Please try again.');
      }

      this.state = result.value.state;
      this.seq += 1;
      const finished = this.state.phase === 'finished' && this.state.result !== null;
      if (!finished) this.refreshTimers();
      this.broadcastUpdate(result.value.events);
      if (finished) await this.finish(outcomeFromResult(this.state.result!));
      return ok(undefined);
    });
  }

  forfeit(userId: string): Promise<void> {
    return this.enqueue(async () => {
      const seat = this.seatOf(userId);
      if (this.outcome || seat === null) return;
      await this.finish({ winner: otherPlayer(seat), reason: 'forfeit' });
    });
  }

  /** The manager reports whether the player has at least one open connection. */
  setConnected(seat: PlayerIndex, connected: boolean): void {
    if (this.connected[seat] === connected) return;
    this.connected[seat] = connected;
    if (this.outcome) return;
    if (connected) this.cancelGrace(seat);
    else this.startGrace(seat);
  }

  dispose(): void {
    this.clearTimers();
  }

  // ---------- internals ----------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private broadcastUpdate(events: GameEvent[]): void {
    for (const seat of [0, 1] as const) {
      this.deps.send(this.userOf(seat), {
        type: 'game.update',
        gameId: this.id,
        seq: this.seq,
        events,
        deadline: this.deadline,
        view: viewFor(this.state, seat, this.outcome),
      });
    }
  }

  private async finish(outcome: Outcome): Promise<void> {
    if (this.outcome) return;
    this.outcome = outcome;
    this.clearTimers();

    let rematch: GameRecord | null = null;
    try {
      rematch = await this.deps.store.finishGame(
        this.id,
        outcome,
        outcome.reason === 'sudden_death_rematch'
          ? { seed: this.deps.randomSeed(), prizeCount: 1 }
          : undefined,
      );
    } catch (error) {
      this.deps.log(`Could not mark game ${this.id} as finished`, error);
    }
    for (const seat of [0, 1] as const) {
      this.deps.send(this.userOf(seat), {
        type: 'game.over',
        gameId: this.id,
        outcome,
        rematchGameId: rematch?.id ?? null,
      });
    }
    this.deps.onFinished(this, rematch);
  }

  /** (Re)starts the turn timer when the situation changed, e.g. a new turn began. */
  private refreshTimers(): void {
    const actors = actorsFor(this.state);
    if (this.outcome || actors.length === 0) {
      this.clearTurnTimer();
      this.deadline = null;
      this.signature = '';
      return;
    }
    const signature = signatureOf(this.state);
    if (signature === this.signature && this.turnTimer !== null) return;

    this.clearTurnTimer();
    this.signature = signature;
    this.deadline = this.deps.clock.now() + this.deps.turnTimeoutMs;
    this.turnTimer = this.deps.clock.setTimeout(() => {
      void this.enqueue(() => this.onTurnTimeout(signature)).catch((e) =>
        this.deps.log(`Turn timeout failed for game ${this.id}`, e),
      );
    }, this.deps.turnTimeoutMs);
  }

  private async onTurnTimeout(signature: string): Promise<void> {
    // The timer may have fired just before a move that changed the situation.
    if (this.outcome || signature !== this.signature) return;
    this.turnTimer = null;
    const actors = actorsFor(this.state);
    if (actors.length === 0) return;
    if (actors.length === 2) {
      await this.finish({ winner: null, reason: 'abandoned' });
    } else {
      await this.finish({ winner: otherPlayer(actors[0]!), reason: 'timeout' });
    }
  }

  private startGrace(seat: PlayerIndex): void {
    this.cancelGrace(seat);
    this.graceTimers[seat] = this.deps.clock.setTimeout(() => {
      void this.enqueue(() => this.onGraceExpired(seat)).catch((e) =>
        this.deps.log(`Disconnect handling failed for game ${this.id}`, e),
      );
    }, this.deps.disconnectGraceMs);
  }

  private cancelGrace(seat: PlayerIndex): void {
    if (this.graceTimers[seat] !== null) {
      this.deps.clock.clearTimeout(this.graceTimers[seat]);
      this.graceTimers[seat] = null;
    }
  }

  private async onGraceExpired(seat: PlayerIndex): Promise<void> {
    this.graceTimers[seat] = null;
    if (this.outcome || this.connected[seat]) return;
    const other = otherPlayer(seat);
    if (!this.connected[other]) await this.finish({ winner: null, reason: 'abandoned' });
    else await this.finish({ winner: other, reason: 'disconnect' });
  }

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) this.deps.clock.clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private clearTimers(): void {
    this.clearTurnTimer();
    this.cancelGrace(0);
    this.cancelGrace(1);
  }
}
