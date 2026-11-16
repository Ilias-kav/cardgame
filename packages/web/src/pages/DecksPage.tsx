import { starterDecks } from '@cardgame/engine';
import type { DeckSummaryDto } from '@cardgame/protocol';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { DECK_SIZE } from '../deck/editor.js';
import { errorMessage } from '../errors.js';
import { navigate, paths } from '../router.js';
import { useToasts } from '../toasts.js';

export function DecksPage() {
  const toasts = useToasts();
  const [decks, setDecks] = useState<DeckSummaryDto[] | null>(null);

  const load = useCallback(async () => {
    try {
      setDecks(await api.decks());
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    }
  }, [toasts]);
  useEffect(() => {
    void load();
  }, [load]);

  async function addStarter(key: string) {
    try {
      await api.createDeck(`Starter: ${key}`, starterDecks[key]!);
      toasts.push(`Added the ${key} starter deck.`, 'success');
      await load();
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    }
  }

  async function remove(deck: DeckSummaryDto) {
    if (!window.confirm(`Delete "${deck.name}"?`)) return;
    try {
      await api.deleteDeck(deck.id);
      await load();
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    }
  }

  return (
    <main className="page">
      <div className="row space-between">
        <h1>My decks</h1>
        <button type="button" className="primary" onClick={() => navigate(paths.newDeck)} data-testid="new-deck">
          New deck
        </button>
      </div>
      {decks === null && <p className="muted">Loading…</p>}
      {decks !== null && decks.length === 0 && <p className="muted">You have no decks yet. Build one, or add a ready-made starter deck below.</p>}
      <ul className="deck-list">
        {decks?.map((d) => (
          <li key={d.id} className="panel row space-between" data-testid="deck-row">
            <div>
              <strong>{d.name}</strong>{' '}
              <span className={`badge ${d.valid ? 'badge-ok' : 'badge-warn'}`}>{d.valid ? 'ready to play' : 'incomplete'}</span>
              <div className="muted small">
                {d.cardCount}/{DECK_SIZE} cards
              </div>
            </div>
            <div className="row">
              <button type="button" onClick={() => navigate(paths.deck(d.id))}>
                Edit
              </button>
              <button type="button" onClick={() => void remove(d)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <h2>Starter decks</h2>
      <p className="muted small">Ready-made 60-card decks (placeholder cards) so you can start playing right away.</p>
      <div className="row">
        {Object.keys(starterDecks).map((key) => (
          <button key={key} type="button" onClick={() => void addStarter(key)} data-testid={`add-starter-${key}`}>
            Add “{key}”
          </button>
        ))}
      </div>
    </main>
  );
}
