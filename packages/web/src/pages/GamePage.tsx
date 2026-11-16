import type { Action, CardCatalog, CreatureRef, PlayerIndex } from '@cardgame/engine';
import type { OpponentSide, OwnSide, PlayerView } from '@cardgame/protocol';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useCatalog } from '../catalog.js';
import { ActionPanel } from '../components/ActionPanel.js';
import { EventLog } from '../components/EventLog.js';
import { GameOver } from '../components/GameOver.js';
import { CardButton, CreatureTile, EmptySlot, TurnTimer } from '../components/parts.js';
import { SetupPanel } from '../components/SetupPanel.js';
import { useGame } from '../gameContext.js';
import type { Fx } from '../game/effects.js';
import { canActInMainPhase, sameRef, turnStatus } from '../game/hints.js';
import {
  NONE,
  clickHandCard,
  clickMyCreature,
  targetsFor,
  validateSelection,
  type Selection,
} from '../game/interaction.js';
import { useGameFeedback } from '../useGameFeedback.js';
import { navigate, paths } from '../router.js';
import { useSession } from '../session.js';
import { useToasts } from '../toasts.js';

function SideInfo({ label, side, catalog }: { label: string; side: OwnSide | OpponentSide; catalog: CardCatalog }) {
  const handCount = 'hand' in side ? side.hand.length : side.handCount;
  return (
    <div className="side-info">
      <strong>{label}</strong>
      <span title="Cards in deck">📚 {side.deckCount}</span>
      <span title="Cards in hand">🖐 {handCount}</span>
      <span title="Prize cards left">🏆 {side.prizeCount}</span>
      <details>
        <summary title="Discard pile">🗑 {side.discard.length}</summary>
        <ul className="discard">
          {side.discard.map((c) => (
            <li key={c.iid}>{catalog[c.cardId]?.name ?? c.cardId}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Bench({
  creatures,
  catalog,
  prefix,
  mine,
  selection,
  targets,
  onClick,
  fxFor,
}: {
  creatures: PlayerView['you']['bench'];
  catalog: CardCatalog;
  prefix: string;
  mine: boolean;
  selection: Selection;
  targets: CreatureRef[];
  onClick(ref: CreatureRef): void;
  fxFor(key: string): Fx[];
}) {
  return (
    <div className="bench">
      {Array.from({ length: 5 }, (_, index) => {
        const creature = creatures[index];
        const ref: CreatureRef = { zone: 'bench', index };
        if (!creature) return <EmptySlot key={index} label={`Bench ${index + 1}`} />;
        return (
          <CreatureTile
            key={index}
            creature={creature}
            catalog={catalog}
            title={`Bench ${index + 1}`}
            selected={mine && selection.kind === 'creature' && sameRef(selection.ref, ref)}
            highlight={mine && targets.some((t) => sameRef(t, ref))}
            onClick={mine ? () => onClick(ref) : undefined}
            testId={`${prefix}-bench-${index}`}
            fx={fxFor(`${mine ? 'me' : 'opp'}-bench-${index}`)}
          />
        );
      })}
    </div>
  );
}

export function GamePage() {
  const { catalog } = useCatalog();
  const { user } = useSession();
  const { state, sendAction, forfeit, leaveGame } = useGame();
  const toasts = useToasts();
  const [selection, setSelection] = useState<Selection>(NONE);
  const [fetchedOpponent, setFetchedOpponent] = useState<string | null>(null);
  const view = state.view;
  const fx = useGameFeedback(state, state.seat);
  const fxFor = (key: string) => fx.filter((f) => f.key === key);

  // Drop a selection that no longer exists (e.g. the card was played).
  useEffect(() => {
    if (view) setSelection((s) => validateSelection(view, s));
  }, [view]);

  // After a reconnect we may not know the opponent's name: ask the server.
  useEffect(() => {
    if (!state.gameId || state.opponent || fetchedOpponent) return;
    let cancelled = false;
    api
      .game(state.gameId)
      .then((g) => {
        if (!cancelled) setFetchedOpponent(g.players.find((p) => p.seat !== g.seat)?.username ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.gameId, state.opponent, fetchedOpponent]);

  const leave = () => {
    leaveGame();
    setSelection(NONE);
    navigate(paths.lobby);
  };

  if (!view || state.seat === null) {
    if (state.over) {
      return <GameOver over={state.over} mySeat={0} names={['You', 'your opponent']} onLeave={leave} />;
    }
    return (
      <main className="page center">
        {state.gameId ? (
          <p className="muted">Loading the game…</p>
        ) : (
          <>
            <p>You are not in a running game.</p>
            <a href={paths.lobby}>Go to the lobby</a>
          </>
        )}
      </main>
    );
  }

  const seat: PlayerIndex = view.seat;
  const opponentName = state.opponent ?? fetchedOpponent ?? 'Opponent';
  const names: [string, string] = seat === 0 ? [user?.username ?? 'You', opponentName] : [opponentName, user?.username ?? 'You'];
  const targets = targetsFor(view, catalog, selection);
  const myMain = canActInMainPhase(view);
  const inSetup = view.phase === 'setup';

  const send = (action: Action) => sendAction(action);

  const onMyCreature = (ref: CreatureRef) => {
    const result = clickMyCreature(view, catalog, selection, ref);
    if (result.message) toasts.push(result.message, 'info');
    setSelection(result.selection);
    if (result.action) send(result.action);
  };

  const giveUp = () => {
    if (window.confirm('Give up this game? Your opponent will win.')) forfeit();
  };

  return (
    <main className="game" data-testid="game-page">
      <section className="board" aria-label="Board">
        <SideInfo label={opponentName} side={view.opponent} catalog={catalog} />
        <Bench creatures={view.opponent.bench} catalog={catalog} prefix="opp" mine={false} selection={NONE} targets={[]} onClick={() => undefined} fxFor={fxFor} />
        <div className="active-slot">
          {view.opponent.active ? (
            <CreatureTile creature={view.opponent.active} catalog={catalog} title="Active" testId="opp-active" fx={fxFor('opp-active')} />
          ) : (
            <EmptySlot label={inSetup ? 'Hidden until both are ready' : 'No active creature'} fx={fxFor('opp-active')} />
          )}
        </div>

        <div className="status-bar" data-testid="status-bar">
          <span key={`${view.turn}-${view.currentPlayer}-${view.pendingDecisions.length}`} className={`status-text ${view.currentPlayer === seat && !inSetup ? 'mine' : ''}`} data-testid="status-text">
            {turnStatus(view, names)}
          </span>
          {!inSetup && <span className="muted small">Turn {view.turn}</span>}
          <TurnTimer deadline={state.deadline} />
          {myMain && (
            <button type="button" className="primary" onClick={() => send({ type: 'END_TURN' })} data-testid="end-turn">
              End turn
            </button>
          )}
          <button type="button" onClick={giveUp} data-testid="forfeit">
            Give up
          </button>
        </div>

        <div className="active-slot">
          {view.you.active ? (
            <CreatureTile
              creature={view.you.active}
              catalog={catalog}
              title="Active"
              selected={selection.kind === 'creature' && selection.ref.zone === 'active'}
              highlight={targets.some((t) => t.zone === 'active')}
              onClick={() => onMyCreature({ zone: 'active' })}
              testId="my-active"
              fx={fxFor('me-active')}
            />
          ) : (
            <EmptySlot label={inSetup ? 'Not placed yet' : 'No active creature'} fx={fxFor('me-active')} />
          )}
        </div>
        <Bench creatures={view.you.bench} catalog={catalog} prefix="my" mine selection={selection} targets={targets} onClick={onMyCreature} fxFor={fxFor} />
        <SideInfo label={`${user?.username ?? 'You'} (you)`} side={view.you} catalog={catalog} />

        <div className="hand" aria-label="Your hand" data-testid="hand">
          {view.you.hand.map((c) => {
            const def = catalog[c.cardId];
            if (!def) return null;
            return (
              <CardButton
                key={c.iid}
                card={def}
                selected={selection.kind === 'hand' && selection.iid === c.iid}
                onClick={inSetup ? undefined : () => setSelection(clickHandCard(selection, c.iid).selection)}
                testId={`hand-${c.iid}`}
              />
            );
          })}
          {view.you.hand.length === 0 && <span className="muted small">Your hand is empty.</span>}
        </div>
      </section>

      <aside className="side">
        {inSetup ? (
          <SetupPanel
            view={view}
            catalog={catalog}
            onDraw={(count) => send({ type: 'SETUP_DRAW_EXTRA', count })}
            onPlace={(active, bench) => send({ type: 'SETUP_PLACE', active, bench })}
          />
        ) : (
          <ActionPanel view={view} catalog={catalog} selection={selection} setSelection={setSelection} send={send} />
        )}
        <EventLog log={state.log} catalog={catalog} mySeat={seat} names={names} />
        <p className="muted small">
          Connection: {state.connection}
          {state.connection !== 'open' && ' — reconnecting automatically'}
        </p>
      </aside>

      {state.over && <GameOver over={state.over} mySeat={seat} names={names} onLeave={leave} />}
    </main>
  );
}
