import {
  creatureCard,
  getCard,
  type CardCatalog,
  type CreatureInPlay,
  type GameState,
  type PlayerIndex,
} from '../src/index.js';

/** Throws a descriptive error if the state breaks a structural rule of the game. */
export function checkInvariants(catalog: CardCatalog, state: GameState, label = ''): void {
  const fail = (msg: string): never => {
    throw new Error(`Invariant violated${label ? ` (${label})` : ''}: ${msg}`);
  };

  // Plain JSON: survives a round trip unchanged.
  if (JSON.stringify(JSON.parse(JSON.stringify(state))) !== JSON.stringify(state)) fail('not serializable');

  const seen = new Set<string>();
  for (const p of [0, 1] as const) {
    const pl = state.players[p];
    const inPlay: CreatureInPlay[] = [...(pl.active ? [pl.active] : []), ...pl.bench];
    const cards = [
      ...pl.deck,
      ...pl.hand,
      ...pl.prizes,
      ...pl.discard,
      ...inPlay.flatMap((c) => [...c.stack, ...c.attached]),
    ];
    if (cards.length !== 60) fail(`player ${p} has ${cards.length} cards instead of 60`);
    for (const c of cards) {
      if (seen.has(c.iid)) fail(`duplicate card ${c.iid}`);
      seen.add(c.iid);
      if (!catalog[c.cardId]) fail(`unknown card ${c.cardId}`);
      if (!c.iid.startsWith(`p${p}-`)) fail(`card ${c.iid} is in player ${p}'s zones`);
    }
    if (pl.bench.length > 5) fail(`player ${p} bench has ${pl.bench.length} creatures`);
    if (pl.prizes.length > state.prizeCount) fail(`player ${p} has too many prizes`);

    inPlay.forEach((creature, i) => {
      const where = `player ${p} ${creature === pl.active ? 'active' : `bench ${i - (pl.active ? 1 : 0)}`}`;
      const stages = creature.stack.map((c) => {
        const card = getCard(catalog, c.cardId);
        if (card.kind !== 'creature') return fail(`${where}: non-creature in stack`);
        return card;
      });
      const order = ['basic', 'stage1', 'stage2'];
      stages.forEach((card, idx) => {
        if (card.stage !== order[idx]) fail(`${where}: stack stage order broken`);
        const below = stages[idx - 1];
        if (below && card.evolvesFrom !== below.name) fail(`${where}: wrong evolution lineage`);
      });
      for (const a of creature.attached) {
        if (getCard(catalog, a.cardId).kind !== 'power') fail(`${where}: non-power attached`);
      }
      if (creature.damage < 0) fail(`${where}: negative damage`);
      if (creature.damage >= creatureCard(catalog, creature).hp) fail(`${where}: alive with no HP left`);
      if (creature !== pl.active && (creature.status || creature.poisoned)) {
        fail(`${where}: status on a benched creature`);
      }
    });

    if (state.phase === 'playing' && pl.active === null) {
      const waiting = state.pendingDecisions.some((d) => d.player === (p as PlayerIndex));
      if (!waiting) fail(`player ${p} has no active creature and no pending promotion`);
      if (pl.bench.length === 0) fail(`player ${p} waits to promote but has no bench`);
    }
  }

  for (const d of state.pendingDecisions) {
    if (state.players[d.player].active !== null) fail('pending promotion for a player with an active creature');
  }
  if (state.phase === 'finished' && !state.result) fail('finished without a result');
  if (state.phase !== 'finished' && state.result) fail('result before the game finished');
  if (state.phase === 'playing' && state.turn < 1) fail('turn number below 1');
}
