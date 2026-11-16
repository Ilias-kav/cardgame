import { useCallback, useEffect, useState } from 'react';

/** The pages of the app. Routing uses the URL hash (#/lobby), so no server setup is needed. */
export type Route =
  | { name: 'lobby' }
  | { name: 'decks' }
  | { name: 'deck'; id: string } // id is a deck id, or "new"
  | { name: 'game' }
  | { name: 'notfound' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'lobby' };
  if (parts[0] === 'lobby' && parts.length === 1) return { name: 'lobby' };
  if (parts[0] === 'game' && parts.length === 1) return { name: 'game' };
  if (parts[0] === 'decks' && parts.length === 1) return { name: 'decks' };
  if (parts[0] === 'decks' && parts.length === 2 && parts[1]) {
    return { name: 'deck', id: decodeURIComponent(parts[1]) };
  }
  return { name: 'notfound' };
}

export const paths = {
  lobby: '#/lobby',
  decks: '#/decks',
  newDeck: '#/decks/new',
  deck: (id: string) => `#/decks/${encodeURIComponent(id)}`,
  game: '#/game',
} as const;

export function navigate(to: string): void {
  if (window.location.hash === to) return;
  window.location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const update = useCallback(() => setRoute(parseRoute(window.location.hash)), []);
  useEffect(() => {
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [update]);
  return route;
}
