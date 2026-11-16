import { getCard, isBasicCreature, type CardCatalog } from './cards.js';
import { expandDeck, validateDeck, type DeckEntry, type DeckError } from './deck.js';
import type { GameEvent } from './events.js';
import { Rng } from './rng.js';
import { err, ok, type Result, type Transition } from './result.js';
import { RULES } from './rules.js';
import { beginTurn } from './turn.js';
import { cloneState } from './util.js';
import type {
  CardInstance,
  CreatureInPlay,
  GameState,
  PlayerIndex,
  PlayerState,
} from './state.js';

export interface GameOptions {
  /** Defaults to 6. Use 1 for the sudden-death rematch. */
  prizeCount?: number;
}

export type CreateGameError = { code: 'INVALID_DECK'; player: PlayerIndex; errors: DeckError[] };

function buildDeck(player: PlayerIndex, entries: readonly DeckEntry[]): CardInstance[] {
  return expandDeck(entries).map((cardId, i) => ({ iid: `p${player}-${i}`, cardId }));
}

function newPlayer(index: PlayerIndex, entries: readonly DeckEntry[]): PlayerState {
  return {
    deck: buildDeck(index, entries),
    hand: [],
    prizes: [],
    discard: [],
    active: null,
    bench: [],
    powerAttachedThisTurn: false,
  };
}

function hasBasic(catalog: CardCatalog, cards: readonly CardInstance[]): boolean {
  return cards.some((c) => isBasicCreature(getCard(catalog, c.cardId)));
}

function dealPrizes(p: PlayerState, count: number): void {
  p.prizes = p.deck.splice(0, count);
}

function draw(p: PlayerState, count: number): void {
  p.hand.push(...p.deck.splice(0, count));
}

/**
 * Creates a game: coin flip, shuffle, prizes, opening hands, mulligans.
 * The result is in phase 'setup': both players still have to (optionally)
 * take their extra mulligan draws and place their starting creatures.
 *
 * Coin flip convention: heads = player 0 starts, tails = player 1 starts.
 */
export function createGame(
  catalog: CardCatalog,
  deckA: readonly DeckEntry[],
  deckB: readonly DeckEntry[],
  seed: number,
  options: GameOptions = {},
): Result<Transition> | { ok: false; error: CreateGameError } {
  const decks = [deckA, deckB] as const;
  for (const p of [0, 1] as const) {
    const errors = validateDeck(catalog, decks[p]);
    if (errors.length > 0) return { ok: false, error: { code: 'INVALID_DECK', player: p, errors } };
  }

  const prizeCount = options.prizeCount ?? RULES.prizeCount;
  if (!Number.isInteger(prizeCount) || prizeCount < 1 || prizeCount > RULES.prizeCount) {
    return err('INVALID_OPTIONS', `prizeCount must be between 1 and ${RULES.prizeCount}`);
  }
  const rng = new Rng(seed);
  const events: GameEvent[] = [];

  const players: [PlayerState, PlayerState] = [newPlayer(0, deckA), newPlayer(1, deckB)];

  const heads = rng.coinFlip();
  const firstPlayer: PlayerIndex = heads ? 0 : 1;
  events.push({ type: 'COIN_FLIP', purpose: 'first_player', heads, winner: firstPlayer });

  for (const p of players) {
    rng.shuffle(p.deck);
    dealPrizes(p, prizeCount);
    draw(p, RULES.startingHandSize);
  }

  const extra: [number, number] = [0, 0];
  const mulligans: [number, number] = [0, 0];

  /** Hand goes back into the deck, deck is shuffled, a new hand is drawn. */
  const redraw = (index: PlayerIndex): void => {
    const p = players[index];
    // Safety net: if every basic ended up in the prize cards, no redraw could ever
    // succeed, so put the prizes back and deal them again.
    while (!hasBasic(catalog, p.deck) && !hasBasic(catalog, p.hand)) {
      p.deck.push(...p.prizes);
      p.prizes = [];
      rng.shuffle(p.deck);
      dealPrizes(p, prizeCount);
    }
    p.deck.push(...p.hand);
    p.hand = [];
    rng.shuffle(p.deck);
    draw(p, RULES.startingHandSize);
  };

  for (let guard = 0; ; guard++) {
    if (guard > 10_000) throw new Error('Mulligan loop did not terminate');
    const ok0 = hasBasic(catalog, players[0].hand);
    const ok1 = hasBasic(catalog, players[1].hand);
    if (ok0 && ok1) break;

    if (!ok0 && !ok1) {
      // Both failed: both reveal and redraw, nobody gets extra cards.
      for (const i of [0, 1] as const) {
        events.push({
          type: 'MULLIGAN',
          player: i,
          revealedHand: players[i].hand.map((c) => c.cardId),
          opponentMayDraw: false,
        });
        mulligans[i]++;
        redraw(i);
      }
    } else {
      const failed: PlayerIndex = ok0 ? 1 : 0;
      const other: PlayerIndex = ok0 ? 0 : 1;
      events.push({
        type: 'MULLIGAN',
        player: failed,
        revealedHand: players[failed].hand.map((c) => c.cardId),
        opponentMayDraw: true,
      });
      mulligans[failed]++;
      extra[other] += RULES.mulliganExtraDraw;
      redraw(failed);
    }
  }

  const state: GameState = {
    phase: 'setup',
    players,
    firstPlayer,
    currentPlayer: firstPlayer,
    turn: 0,
    prizeCount,
    rngState: rng.state,
    setup: {
      extraDrawAvailable: extra,
      extraDrawResolved: [extra[0] === 0, extra[1] === 0],
      placed: [false, false],
      mulligans,
    },
    turnStage: 'main',
    pendingDecisions: [],
    result: null,
  };
  return ok({ state, events });
}

/** Setup step 1 (optional): draw some or all of the extra mulligan cards. */
export function setupDrawExtra(
  state: GameState,
  player: PlayerIndex,
  count: number,
): Result<Transition> {
  const setup = state.setup;
  if (state.phase !== 'setup' || !setup) return err('WRONG_PHASE', 'Not in setup');
  if (setup.extraDrawResolved[player]) return err('NOTHING_TO_DRAW', 'Extra draw already resolved');
  if (setup.placed[player]) return err('ALREADY_PLACED', 'Creatures already placed');
  if (!Number.isInteger(count) || count < 0 || count > setup.extraDrawAvailable[player]) {
    return err('INVALID_COUNT', `You may draw between 0 and ${setup.extraDrawAvailable[player]}`);
  }

  const next = cloneState(state);
  const p = next.players[player];
  draw(p, count);
  next.setup!.extraDrawResolved[player] = true;
  return ok({ state: next, events: [{ type: 'EXTRA_DRAW', player, count }] });
}

/** Setup step 2: put one basic creature as active and any other basics on the bench. */
export function setupPlace(
  catalog: CardCatalog,
  state: GameState,
  player: PlayerIndex,
  activeIid: string,
  benchIids: readonly string[],
): Result<Transition> {
  const setup = state.setup;
  if (state.phase !== 'setup' || !setup) return err('WRONG_PHASE', 'Not in setup');
  if (setup.placed[player]) return err('ALREADY_PLACED', 'Creatures already placed');
  if (!setup.extraDrawResolved[player]) {
    return err('EXTRA_DRAW_PENDING', 'Draw (or decline) your extra cards first');
  }
  if (benchIids.length > RULES.benchSize) {
    return err('BENCH_TOO_LARGE', `Bench holds at most ${RULES.benchSize} creatures`);
  }

  const all = [activeIid, ...benchIids];
  if (new Set(all).size !== all.length) return err('DUPLICATE_CARD', 'A card was listed twice');

  const hand = state.players[player].hand;
  for (const iid of all) {
    const card = hand.find((c) => c.iid === iid);
    if (!card) return err('NOT_IN_HAND', `Card ${iid} is not in your hand`);
    if (!isBasicCreature(getCard(catalog, card.cardId))) {
      return err('NOT_BASIC', `Card ${iid} is not a basic creature`);
    }
  }

  const next = cloneState(state);
  const p = next.players[player];
  const take = (iid: string): CreatureInPlay => {
    const idx = p.hand.findIndex((c) => c.iid === iid);
    const [card] = p.hand.splice(idx, 1);
    return {
      stack: [card as CardInstance],
      attached: [],
      damage: 0,
      status: null,
      poisoned: false,
      playedOnTurn: 0,
      evolvedOnTurn: 0,
    };
  };
  p.active = take(activeIid);
  p.bench = benchIids.map(take);
  next.setup!.placed[player] = true;

  const events: GameEvent[] = [{ type: 'SETUP_PLACED', player }];
  if (next.setup!.placed[0] && next.setup!.placed[1]) {
    next.phase = 'playing';
    next.setup = null;
    events.push({ type: 'GAME_STARTED', firstPlayer: next.firstPlayer });
    // The first player's first turn starts right away (turn 1, including the draw).
    beginTurn(next, events, next.firstPlayer);
  }
  return ok({ state: next, events });
}
