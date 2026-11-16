import type { Card, Nature } from '@cardgame/engine';
import { POWER_TYPES } from '@cardgame/engine';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useCatalog } from '../catalog.js';
import { CardButton } from '../components/parts.js';
import {
  DECK_SIZE,
  addCard,
  cardSummary,
  copyLimit,
  deckProblems,
  filterCards,
  fromEntries,
  kindTotals,
  removeCard,
  sortCards,
  toEntries,
  totalCards,
  type DeckCounts,
} from '../deck/editor.js';
import { errorMessage } from '../errors.js';
import { navigate, paths } from '../router.js';
import { useToasts } from '../toasts.js';

export function DeckEditorPage({ id }: { id: string }) {
  const { catalog, cards } = useCatalog();
  const toasts = useToasts();
  const isNew = id === 'new';

  const [name, setName] = useState('New deck');
  const [counts, setCounts] = useState<DeckCounts>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [kind, setKind] = useState<Card['kind'] | 'all'>('all');
  const [nature, setNature] = useState<Nature | 'all'>('all');
  const [text, setText] = useState('');

  useEffect(() => {
    if (isNew) {
      setName('New deck');
      setCounts({});
      setDirty(false);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api
      .deck(id)
      .then((deck) => {
        if (cancelled) return;
        setName(deck.name);
        setCounts(fromEntries(deck.cards));
        setDirty(false);
      })
      .catch((e: unknown) => {
        toasts.push(errorMessage(e), 'error');
        navigate(paths.decks);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, isNew, toasts]);

  const problems = useMemo(() => deckProblems(catalog, counts), [catalog, counts]);
  const total = totalCards(counts);
  const kinds = kindTotals(catalog, counts);
  const shown = useMemo(() => filterCards(cards, { kind, nature, text }), [cards, kind, nature, text]);
  const inDeck = useMemo(
    () => sortCards(Object.keys(counts).map((cid) => catalog[cid]).filter((c): c is Card => c !== undefined)),
    [catalog, counts],
  );

  const change = (next: DeckCounts) => {
    setCounts(next);
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const deck = await api.createDeck(name.trim(), toEntries(counts));
        toasts.push('Deck saved.', 'success');
        navigate(paths.deck(deck.id));
      } else {
        await api.updateDeck(id, name.trim(), toEntries(counts));
        setDirty(false);
        toasts.push('Deck saved.', 'success');
      }
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await api.deleteDeck(id);
      navigate(paths.decks);
    } catch (e) {
      toasts.push(errorMessage(e), 'error');
    }
  }

  if (loading) return <p className="center muted">Loading deck…</p>;

  return (
    <main className="editor">
      <section className="panel catalog" aria-label="Card catalog">
        <h2>Cards</h2>
        <div className="row filters">
          <input placeholder="Search by name" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search cards" data-testid="card-search" />
          <select value={kind} onChange={(e) => setKind(e.target.value as Card['kind'] | 'all')} aria-label="Card type">
            <option value="all">All types</option>
            <option value="creature">Creatures</option>
            <option value="item">Items</option>
            <option value="power">Power cards</option>
          </select>
          <select value={nature} onChange={(e) => setNature(e.target.value as Nature | 'all')} aria-label="Element">
            <option value="all">All elements</option>
            {[...POWER_TYPES, 'neutral' as const].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <ul className="catalog-list">
          {shown.map((card) => {
            const n = counts[card.id] ?? 0;
            const atLimit = n >= copyLimit(card);
            return (
              <li key={card.id} className="catalog-row" data-testid={`catalog-${card.id}`}>
                <CardButton card={card} badge={n > 0 ? `×${n}` : undefined} />
                <span className="muted small summary">{cardSummary(card)}</span>
                <span className="row">
                  <button type="button" onClick={() => change(removeCard(counts, card.id))} disabled={n === 0} aria-label={`Remove one ${card.name}`}>
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => change(addCard(counts, card))}
                    disabled={atLimit}
                    aria-label={`Add one ${card.name}`}
                    title={atLimit ? 'Copy limit reached' : undefined}
                    data-testid={`add-${card.id}`}
                  >
                    +
                  </button>
                </span>
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted">No cards match.</li>}
        </ul>
      </section>

      <section className="panel deck" aria-label="Your deck">
        <label>
          Deck name
          <input value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setDirty(true); }} data-testid="deck-name" />
        </label>
        <div className={`count ${total === DECK_SIZE ? 'count-ok' : ''}`} data-testid="deck-count">
          {total} / {DECK_SIZE} cards
        </div>
        <div className="muted small">
          {kinds.creature} creatures · {kinds.item} items · {kinds.power} power cards
        </div>
        {problems.length === 0 ? (
          <p className="ok" data-testid="deck-valid">✓ This deck is ready to play.</p>
        ) : (
          <ul className="problems" data-testid="deck-problems">
            {problems.map((p) => (
              <li key={`${p.code}-${p.cardId ?? ''}`}>{p.message}</li>
            ))}
          </ul>
        )}
        <ul className="deck-cards">
          {inDeck.map((card) => (
            <li key={card.id} className="row space-between">
              <span>
                {counts[card.id]}× {card.name}
              </span>
              <span className="row">
                <button type="button" onClick={() => change(removeCard(counts, card.id))} aria-label={`Remove one ${card.name} from the deck`}>
                  −
                </button>
              </span>
            </li>
          ))}
          {inDeck.length === 0 && <li className="muted">Add cards from the list.</li>}
        </ul>
        <div className="row">
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || name.trim() === ''} data-testid="save-deck">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {dirty && <span className="muted small">Unsaved changes</span>}
          {!isNew && (
            <button type="button" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button type="button" onClick={() => navigate(paths.decks)}>
            Back
          </button>
        </div>
        <p className="muted small">You can save an unfinished deck, but only a complete 60-card deck can be used in a game.</p>
      </section>
    </main>
  );
}
