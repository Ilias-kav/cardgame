import type {
  ApiErrorBody,
  DeckDetailDto,
  DeckSummaryDto,
  GameSummaryDto,
  OpenGameDto,
  UserDto,
} from '@cardgame/protocol';
import type { Card, DeckEntry } from '@cardgame/engine';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Typed wrapper around the HTTP API (see docs/API.md). Pass a fake fetch in tests. */
export function createApi(fetchFn: FetchLike = (input, init) => fetch(input, init)) {
  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        credentials: 'same-origin',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is it running?');
    }
    if (res.status === 204) return undefined as T;

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const e = (json as ApiErrorBody | null)?.error;
      throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return json as T;
  }

  const cardInput = (cards: DeckEntry[]) => cards.map(({ cardId, count }) => ({ cardId, count }));

  return {
    /** The logged-in user, or null when there is no valid session. */
    async me(): Promise<UserDto | null> {
      try {
        return (await request<{ user: UserDto }>('GET', '/api/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    register: async (username: string, password: string) =>
      (await request<{ user: UserDto }>('POST', '/api/auth/register', { username, password })).user,
    login: async (username: string, password: string) =>
      (await request<{ user: UserDto }>('POST', '/api/auth/login', { username, password })).user,
    logout: () => request<void>('POST', '/api/auth/logout'),

    cards: async () => (await request<{ cards: Card[] }>('GET', '/api/cards')).cards,

    decks: async () => (await request<{ decks: DeckSummaryDto[] }>('GET', '/api/decks')).decks,
    deck: async (id: string) =>
      (await request<{ deck: DeckDetailDto }>('GET', `/api/decks/${encodeURIComponent(id)}`)).deck,
    createDeck: async (name: string, cards: DeckEntry[]) =>
      (await request<{ deck: DeckDetailDto }>('POST', '/api/decks', { name, cards: cardInput(cards) })).deck,
    updateDeck: async (id: string, name: string, cards: DeckEntry[]) =>
      (
        await request<{ deck: DeckDetailDto }>('PUT', `/api/decks/${encodeURIComponent(id)}`, {
          name,
          cards: cardInput(cards),
        })
      ).deck,
    deleteDeck: (id: string) => request<void>('DELETE', `/api/decks/${encodeURIComponent(id)}`),

    lobby: () => request<{ open: OpenGameDto[]; current: GameSummaryDto | null }>('GET', '/api/games'),
    createGame: async (deckId: string) =>
      (await request<{ game: GameSummaryDto }>('POST', '/api/games', { deckId })).game,
    joinGame: async (gameId: string, deckId: string) =>
      (await request<{ game: GameSummaryDto }>('POST', `/api/games/${encodeURIComponent(gameId)}/join`, { deckId }))
        .game,
    cancelGame: (gameId: string) => request<void>('DELETE', `/api/games/${encodeURIComponent(gameId)}`),
    game: async (gameId: string) =>
      (await request<{ game: GameSummaryDto }>('GET', `/api/games/${encodeURIComponent(gameId)}`)).game,
  };
}

export type Api = ReturnType<typeof createApi>;
export const api: Api = createApi();
