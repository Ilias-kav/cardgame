import type { GameEvent, PlayerIndex } from '@cardgame/engine';
import type { GameStatus, Outcome, PlayerView, ServerMessage } from '@cardgame/protocol';
import type { SocketStatus } from '../socket.js';

export interface LogEntry {
  id: number;
  event: GameEvent;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

export interface GameOver {
  /** null = the game ended while we were disconnected and we do not know how. */
  outcome: Outcome | null;
  rematchGameId: string | null;
}

export interface GameClientState {
  connection: SocketStatus;
  /** Your waiting/active game as reported when the socket connected. */
  helloGame: { id: string; status: GameStatus } | null;
  gameId: string | null;
  seat: PlayerIndex | null;
  opponent: string | null;
  view: PlayerView | null;
  /** Number of the last applied update (-1 before the first one). */
  seq: number;
  deadline: number | null;
  log: LogEntry[];
  over: GameOver | null;
  /** Counts `game.started` messages; the UI navigates to the game page when it changes. */
  startedCount: number;
  /** A message was missed: ask the server for a fresh snapshot. */
  needsSync: boolean;
  notice: Notice | null;
}

export const initialGameState: GameClientState = {
  connection: 'closed',
  helloGame: null,
  gameId: null,
  seat: null,
  opponent: null,
  view: null,
  seq: -1,
  deadline: null,
  log: [],
  over: null,
  startedCount: 0,
  needsSync: false,
  notice: null,
};

export type GameAction =
  | { type: 'status'; status: SocketStatus }
  | { type: 'message'; message: ServerMessage }
  | { type: 'clearNotice' }
  | { type: 'reset' };

const MAX_LOG = 300;
let noticeCounter = 0;
const notice = (text: string, tone: Notice['tone']): Notice => ({ id: ++noticeCounter, text, tone });

function appendLog(log: LogEntry[], events: GameEvent[]): LogEntry[] {
  if (events.length === 0) return log;
  let id = log.length > 0 ? log[log.length - 1]!.id + 1 : 1;
  const next = [...log, ...events.map((event) => ({ id: id++, event }))];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
}

/** Pure reducer: how each server message changes what the game screen knows. */
export function gameReducer(state: GameClientState, action: GameAction): GameClientState {
  switch (action.type) {
    case 'reset':
      // Forget the game, but not facts about the connection itself.
      return { ...initialGameState, connection: state.connection, startedCount: state.startedCount };
    case 'clearNotice':
      return { ...state, notice: null };
    case 'status':
      return { ...state, connection: action.status };
    case 'message':
      return applyMessage(state, action.message);
  }
}

function applyMessage(state: GameClientState, m: ServerMessage): GameClientState {
  switch (m.type) {
    case 'hello': {
      // A running game we know about, but the server says we are in none: it ended while we were away.
      const endedWhileAway = m.game === null && state.gameId !== null && state.over === null && state.view !== null;
      return {
        ...state,
        helloGame: m.game,
        over: endedWhileAway ? { outcome: null, rematchGameId: null } : state.over,
      };
    }
    case 'game.started':
      return {
        ...state,
        gameId: m.gameId,
        seat: m.seat,
        opponent: m.opponent,
        view: null,
        seq: -1,
        deadline: null,
        log: [],
        over: null,
        needsSync: false,
        startedCount: state.startedCount + 1,
        helloGame: { id: m.gameId, status: 'active' },
      };
    case 'game.state': {
      const sameGame = state.gameId === m.gameId;
      return {
        ...state,
        gameId: m.gameId,
        seat: m.view.seat,
        view: m.view,
        seq: m.seq,
        deadline: m.deadline,
        needsSync: false,
        over: m.view.outcome ? { outcome: m.view.outcome, rematchGameId: null } : sameGame ? state.over : null,
        log: sameGame ? state.log : [],
        opponent: sameGame ? state.opponent : null,
      };
    }
    case 'game.update': {
      if (state.gameId !== null && m.gameId !== state.gameId) return state; // an old game
      if (m.seq <= state.seq) return state; // duplicate
      const gap = state.gameId === null || (state.seq >= 0 && m.seq !== state.seq + 1) || (state.view === null && m.seq !== 0);
      return {
        ...state,
        gameId: m.gameId,
        seat: m.view.seat,
        view: m.view,
        seq: m.seq,
        deadline: m.deadline,
        log: appendLog(state.log, m.events),
        needsSync: gap ? true : state.needsSync,
      };
    }
    case 'game.over':
      if (state.gameId !== null && m.gameId !== state.gameId) return state;
      return {
        ...state,
        gameId: m.gameId,
        over: { outcome: m.outcome, rematchGameId: m.rematchGameId },
        deadline: null,
        helloGame: null,
      };
    case 'game.cancelled':
      return {
        ...state,
        helloGame: null,
        notice: notice('Nobody joined your game, so it was cancelled.', 'info'),
      };
    case 'error':
      return { ...state, notice: notice(m.message, 'error') };
    case 'ack':
    case 'pong':
      return state;
  }
}
