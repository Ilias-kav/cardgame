import type { DeckSummaryDto, GameSummaryDto, OpenGameDto } from '@cardgame/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { errorMessage } from '../errors.js';
import { useGame } from '../gameContext.js';
import { navigate, paths } from '../router.js';
import { useToasts } from '../toasts.js';

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

export function LobbyPage() {
  const toasts = useToasts();
  const { state } = useGame();
  const [open, setOpen] = useState<OpenGameDto[] | null>(null);
  const [current, setCurrent] = useState<GameSummaryDto | null>(null);
  const [decks, setDecks] = useState<DeckSummaryDto[] | null>(null);
  const [deckId, setDeckId] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const lobby = await api.lobby();
      setOpen(lobby.open);
      setCurrent(lobby.current);
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    }
  }, [toasts]);

  useEffect(() => {
    void refresh();
    api
      .decks()
      .then(setDecks)
      .catch((e: unknown) => toasts.push(errorMessage(e), 'error'));
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, toasts]);

  // The socket told us something changed (game started, cancelled, ended).
  useEffect(() => {
    void refresh();
  }, [refresh, state.startedCount, state.helloGame?.id, state.helloGame?.status, state.over]);

  const validDecks = (decks ?? []).filter((d) => d.valid);
  useEffect(() => {
    if (!validDecks.some((d) => d.id === deckId)) setDeckId(validDecks[0]?.id ?? '');
  }, [validDecks, deckId]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const create = () => run(async () => void (await api.createGame(deckId)));
  const join = (gameId: string) =>
    run(async () => {
      await api.joinGame(gameId, deckId);
      navigate(paths.game);
    });
  const cancel = (gameId: string) => run(() => api.cancelGame(gameId));

  const noDecks = decks !== null && validDecks.length === 0;

  return (
    <main className="page">
      <h1>Lobby</h1>

      {current && current.status === 'active' && (
        <div className="panel banner" data-testid="current-active">
          <strong>You are in a game</strong> against {current.players.find((p) => p.seat !== current.seat)?.username ?? 'an opponent'}.{' '}
          <button type="button" className="primary" onClick={() => navigate(paths.game)} data-testid="resume-game">
            Go to the game
          </button>
        </div>
      )}

      {current && current.status === 'waiting' && (
        <div className="panel banner" data-testid="current-waiting">
          <strong>Waiting for an opponent…</strong> Your game is open in the list below. It starts as soon as someone joins.{' '}
          <button type="button" onClick={() => void cancel(current.id)} disabled={busy} data-testid="cancel-game">
            Cancel game
          </button>
        </div>
      )}

      {noDecks && (
        <p className="panel warn" data-testid="no-decks">
          You need a complete 60-card deck to play.{' '}
          <a href={paths.decks}>Build one or add a starter deck</a>.
        </p>
      )}

      {!current && (
        <div className="panel">
          <h2>Start or join a game</h2>
          <label>
            Your deck
            <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={noDecks || decks === null} data-testid="deck-select">
              {validDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={() => void create()} disabled={busy || deckId === ''} data-testid="create-game">
            Create a game and wait for an opponent
          </button>
        </div>
      )}

      <h2>Open games</h2>
      {open === null && <p className="muted">Loading…</p>}
      {open !== null && open.length === 0 && <p className="muted" data-testid="no-open-games">Nobody is waiting for an opponent right now.</p>}
      <ul className="deck-list">
        {open?.map((g) => (
          <li key={g.id} className="panel row space-between" data-testid="open-game">
            <span>
              <strong>{g.creator.username}</strong> <span className="muted small">created {ago(g.createdAt)}</span>
              {g.mine && <span className="badge"> your game</span>}
            </span>
            {!g.mine && (
              <button type="button" className="primary" disabled={busy || current !== null || deckId === ''} onClick={() => void join(g.id)} data-testid="join-game">
                Join
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
