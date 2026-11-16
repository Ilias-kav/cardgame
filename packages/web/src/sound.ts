import type { SoundKind } from './game/effects.js';

/**
 * Sound effects, synthesized with the Web Audio API (no audio files to download).
 * Browsers only allow sound after the user has clicked something, which always
 * happens before a game starts. Everything is wrapped so that a missing or blocked
 * audio system never breaks the game.
 */
type Note = { freq: number; start: number; length: number; type?: OscillatorType; gain?: number };

const RECIPES: Record<SoundKind, Note[]> = {
  hit: [{ freq: 180, start: 0, length: 0.12, type: 'square', gain: 0.18 }, { freq: 110, start: 0.05, length: 0.12, type: 'square', gain: 0.14 }],
  ko: [{ freq: 220, start: 0, length: 0.15, type: 'sawtooth', gain: 0.2 }, { freq: 110, start: 0.12, length: 0.18, type: 'sawtooth', gain: 0.2 }, { freq: 55, start: 0.26, length: 0.3, type: 'sawtooth', gain: 0.22 }],
  heal: [{ freq: 520, start: 0, length: 0.1, gain: 0.15 }, { freq: 780, start: 0.09, length: 0.16, gain: 0.15 }],
  turn: [{ freq: 440, start: 0, length: 0.1, gain: 0.14 }, { freq: 660, start: 0.1, length: 0.16, gain: 0.14 }],
  coin: [{ freq: 1200, start: 0, length: 0.05, gain: 0.12 }, { freq: 1600, start: 0.06, length: 0.08, gain: 0.12 }],
  win: [{ freq: 523, start: 0, length: 0.15, gain: 0.18 }, { freq: 659, start: 0.15, length: 0.15, gain: 0.18 }, { freq: 784, start: 0.3, length: 0.15, gain: 0.18 }, { freq: 1047, start: 0.45, length: 0.4, gain: 0.18 }],
  lose: [{ freq: 330, start: 0, length: 0.2, type: 'triangle', gain: 0.18 }, { freq: 247, start: 0.2, length: 0.2, type: 'triangle', gain: 0.18 }, { freq: 196, start: 0.4, length: 0.4, type: 'triangle', gain: 0.18 }],
};

const STORAGE_KEY = 'cardgame.muted';

export function loadMuted(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class SoundPlayer {
  private context: AudioContext | null = null;
  muted: boolean;
  /** How many sounds were actually started (handy for tests). */
  played = 0;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
    private readonly createContext: (() => AudioContext) | null = typeof AudioContext === 'undefined' ? null : () => new AudioContext(),
  ) {
    this.muted = loadMuted(storage);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      this.storage?.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable: the choice just will not be remembered */
    }
  }

  play(kind: SoundKind): void {
    if (this.muted || !this.createContext) return;
    try {
      this.context ??= this.createContext();
      const ctx = this.context;
      if (ctx.state === 'suspended') void ctx.resume();
      const t0 = ctx.currentTime;
      for (const note of RECIPES[kind]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type ?? 'sine';
        osc.frequency.value = note.freq;
        const peak = note.gain ?? 0.15;
        gain.gain.setValueAtTime(0.0001, t0 + note.start);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + note.start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.start + note.length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + note.start);
        osc.stop(t0 + note.start + note.length + 0.02);
      }
      this.played++;
    } catch {
      /* audio blocked or unsupported: stay silent */
    }
  }
}

/** The one player used by the app. */
export const sound = new SoundPlayer();
