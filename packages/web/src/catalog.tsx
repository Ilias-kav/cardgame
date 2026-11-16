import type { Card, CardCatalog } from '@cardgame/engine';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.js';
import { sortCards } from './deck/editor.js';

interface CatalogValue {
  /** All cards by id (what the engine functions expect). */
  catalog: CardCatalog;
  /** All cards in display order. */
  cards: Card[];
}

const CatalogContext = createContext<CatalogValue | null>(null);

/** Loads the card catalog once after login; children render when it is ready. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<CatalogValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .cards()
      .then((cards) => {
        if (cancelled) return;
        setValue({
          catalog: Object.fromEntries(cards.map((c) => [c.id, c])),
          cards: sortCards(cards),
        });
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="center error">Could not load the cards: {error}</p>;
  if (!value) return <p className="center muted">Loading cards…</p>;
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside <CatalogProvider>');
  return ctx;
}
