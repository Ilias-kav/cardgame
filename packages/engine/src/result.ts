import type { GameEvent } from './events.js';
import type { GameState } from './state.js';

export interface EngineError {
  code: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

/** The outcome of a successful engine step: the new state plus what happened, in order. */
export interface Transition {
  state: GameState;
  events: GameEvent[];
}
