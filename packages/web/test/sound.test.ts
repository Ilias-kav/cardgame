import { describe, expect, it } from 'vitest';
import { SoundPlayer, loadMuted } from '../src/sound.js';

function fakeContext() {
  const created = { oscillators: 0, resumed: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect: (n: unknown) => n });
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resume() { created.resumed++; return Promise.resolve(); },
    createOscillator() { created.oscillators++; return { ...node(), type: 'sine', frequency: { value: 0 }, start() {}, stop() {} }; },
    createGain() { return { ...node(), gain: param() }; },
  };
  return { ctx: ctx as unknown as AudioContext, created };
}
const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};

describe('SoundPlayer', () => {
  it('plays notes (and wakes a suspended audio context)', () => {
    const { ctx, created } = fakeContext();
    const player = new SoundPlayer(memoryStorage(), () => ctx);
    player.play('ko');
    expect(player.played).toBe(1);
    expect(created.oscillators).toBe(3); // the knockout is three notes
    expect(created.resumed).toBe(1);
  });

  it('stays silent when muted, and remembers the choice', () => {
    const storage = memoryStorage();
    const { ctx, created } = fakeContext();
    const player = new SoundPlayer(storage, () => ctx);
    player.setMuted(true);
    player.play('hit');
    expect(created.oscillators).toBe(0);
    expect(storage.data['cardgame.muted']).toBe('1');
    expect(new SoundPlayer(storage, () => ctx).muted).toBe(true); // a new visit starts muted
    player.setMuted(false);
    expect(storage.data['cardgame.muted']).toBe('0');
  });

  it('never throws when audio is unavailable or broken', () => {
    expect(() => new SoundPlayer(memoryStorage(), null).play('win')).not.toThrow();
    const broken = new SoundPlayer(memoryStorage(), () => { throw new Error('blocked'); });
    expect(() => broken.play('lose')).not.toThrow();
    expect(broken.played).toBe(0);
  });

  it('survives unusable storage', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadMuted(throwing)).toBe(false);
    const player = new SoundPlayer(throwing, null);
    expect(() => player.setMuted(true)).not.toThrow();
    expect(player.muted).toBe(true);
    expect(loadMuted(null)).toBe(false);
  });
});
