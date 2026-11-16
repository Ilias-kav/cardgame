import type { Action } from '@cardgame/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { gameReducer, initialGameState, type GameClientState } from './game/gameStore.js';
import { useSession } from './session.js';
import { useToasts } from './toasts.js';
import { GameSocket, gameSocketUrl } from './socket.js';

interface GameValue {
  state: GameClientState;
  /** Sends a move; shows a message if the connection is down. */
  sendAction(action: Action): void;
  forfeit(): void;
  /** Forgets the finished game (back to the lobby). */
  leaveGame(): void;
}

const GameContext = createContext<GameValue | null>(null);

/** Owns the WebSocket for as long as the user is logged in, and the state it feeds. */
export function GameProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useSession();
  const toasts = useToasts();
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const socketRef = useRef<GameSocket | null>(null);
  const requestCounter = useRef(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return undefined;
    const socket = new GameSocket({
      url: gameSocketUrl(window.location),
      onMessage: (message) => dispatch({ type: 'message', message }),
      onStatus: (status) => dispatch({ type: 'status', status }),
      onTrouble: () => void refresh(),
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      socketRef.current = null;
      dispatch({ type: 'reset' });
    };
  }, [userId, refresh]);

  // A message was missed (or we reconnected mid-game): ask for a fresh snapshot.
  useEffect(() => {
    if (state.needsSync) socketRef.current?.send({ type: 'game.sync' });
  }, [state.needsSync]);

  // Server messages worth telling the player about.
  useEffect(() => {
    if (!state.notice) return;
    toasts.push(state.notice.text, state.notice.tone);
    dispatch({ type: 'clearNotice' });
  }, [state.notice, toasts]);

  const sendAction = useCallback(
    (action: Action) => {
      const requestId = String(++requestCounter.current);
      const sent = socketRef.current?.send({ type: 'game.action', action, requestId });
      if (!sent) toasts.push('Not connected to the server. Trying to reconnect…', 'error');
    },
    [toasts],
  );
  const forfeit = useCallback(() => {
    socketRef.current?.send({ type: 'game.forfeit' });
  }, []);
  const leaveGame = useCallback(() => dispatch({ type: 'reset' }), []);

  const value = useMemo(() => ({ state, sendAction, forfeit, leaveGame }), [state, sendAction, forfeit, leaveGame]);
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
