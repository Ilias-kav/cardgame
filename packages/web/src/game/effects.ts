import type { CreatureRef, GameEvent, PlayerIndex } from '@cardgame/engine';
import type { Outcome } from '@cardgame/protocol';
import type { LogEntry } from './gameStore.js';

/** Visual feedback shown on a creature slot for a moment (floating numbers, flashes). */
export type FxKind = 'damage' | 'heal' | 'ko' | 'status';

export interface Fx {
  /** Unique per event, so a repeated effect restarts its animation. */
  id: number;
  /** Which slot: "me-active", "me-bench-2", "opp-active", ... */
  key: string;
  kind: FxKind;
  text: string;
}

/** The key of a creature slot as seen by `mySeat`. */
export function slotKey(mySeat: PlayerIndex, owner: PlayerIndex, ref: CreatureRef): string {
  const side = owner === mySeat ? 'me' : 'opp';
  return ref.zone === 'active' ? `${side}-active` : `${side}-bench-${ref.index}`;
}

/** Turns newly arrived log entries into things to show on the board. */
export function fxFromEntries(entries: readonly LogEntry[], mySeat: PlayerIndex): Fx[] {
  const out: Fx[] = [];
  for (const { id, event } of entries) {
    switch (event.type) {
      case 'DAMAGE':
        out.push({ id, key: slotKey(mySeat, event.player, event.target), kind: 'damage', text: `−${event.amount}` });
        break;
      case 'CREATURE_HEALED':
        if (event.amount > 0) {
          out.push({ id, key: slotKey(mySeat, event.player, event.target), kind: 'heal', text: `+${event.amount}` });
        }
        break;
      case 'CREATURE_KNOCKED_OUT':
        out.push({ id, key: slotKey(mySeat, event.player, { zone: 'active' }), kind: 'ko', text: 'KO!' });
        break;
      case 'STATUS_APPLIED':
        out.push({ id, key: slotKey(mySeat, event.player, { zone: 'active' }), kind: 'status', text: event.status });
        break;
      default:
        break;
    }
  }
  return out;
}

export type SoundKind = 'hit' | 'ko' | 'heal' | 'turn' | 'coin' | 'win' | 'lose';

/** Which sounds a batch of events deserves (each kind at most once, so a busy turn is not a racket). */
export function soundsFromEvents(events: readonly GameEvent[], mySeat: PlayerIndex): SoundKind[] {
  const kinds = new Set<SoundKind>();
  for (const e of events) {
    if (e.type === 'DAMAGE') kinds.add('hit');
    else if (e.type === 'CREATURE_KNOCKED_OUT') kinds.add('ko');
    else if (e.type === 'CREATURE_HEALED' && e.amount > 0) kinds.add('heal');
    else if (e.type === 'TURN_STARTED' && e.player === mySeat) kinds.add('turn');
    else if (e.type === 'COIN_FLIP' && e.purpose !== 'first_player') kinds.add('coin');
  }
  // A knockout drowns out the plain hit that caused it.
  if (kinds.has('ko')) kinds.delete('hit');
  return [...kinds];
}

export function soundForOutcome(outcome: Outcome | null, mySeat: PlayerIndex): SoundKind | null {
  if (!outcome || outcome.winner === null) return null;
  return outcome.winner === mySeat ? 'win' : 'lose';
}
