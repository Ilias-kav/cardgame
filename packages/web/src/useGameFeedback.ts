import type { PlayerIndex } from '@cardgame/engine';
import { useEffect, useRef, useState } from 'react';
import { fxFromEntries, soundForOutcome, soundsFromEvents, type Fx } from './game/effects.js';
import type { GameClientState } from './game/gameStore.js';
import { sound } from './sound.js';

const FX_MS = 1400;

/**
 * Watches the game log and reacts to NEW entries: returns the floating numbers currently
 * on the board and plays the matching sounds. Nothing happens for entries that were
 * already there when the screen opened (e.g. after a reload).
 */
export function useGameFeedback(state: GameClientState, mySeat: PlayerIndex | null): Fx[] {
  const [fx, setFx] = useState<Fx[]>([]);
  const lastSeen = useRef<number | null>(null);
  const lastGame = useRef<string | null>(null);
  const soundedOver = useRef<string | null>(null);

  useEffect(() => {
    if (mySeat === null) return;
    const newest = state.log.length > 0 ? state.log[state.log.length - 1]!.id : 0;
    // First look at this game (or another game): remember where we are without replaying history.
    if (lastGame.current !== state.gameId || lastSeen.current === null) {
      lastGame.current = state.gameId;
      lastSeen.current = newest;
      return;
    }
    const fresh = state.log.filter((entry) => entry.id > lastSeen.current!);
    lastSeen.current = newest;
    if (fresh.length === 0) return;

    for (const kind of soundsFromEvents(fresh.map((e) => e.event), mySeat)) sound.play(kind);
    const added = fxFromEntries(fresh, mySeat);
    if (added.length === 0) return;
    setFx((current) => [...current, ...added]);
    const ids = new Set(added.map((f) => f.id));
    window.setTimeout(() => setFx((current) => current.filter((f) => !ids.has(f.id))), FX_MS);
  }, [state.log, state.gameId, mySeat]);

  useEffect(() => {
    if (mySeat === null || !state.over || state.gameId === null) return;
    if (soundedOver.current === state.gameId) return;
    soundedOver.current = state.gameId;
    const kind = soundForOutcome(state.over.outcome, mySeat);
    if (kind) sound.play(kind);
  }, [state.over, state.gameId, mySeat]);

  return fx;
}
