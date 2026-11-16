import type { Action, CreatureRef } from './actions.js';
import { getCard, isBasicCreature, type CardCatalog } from './cards.js';
import { defaultEffects, type EffectRegistry } from './effects.js';
import { applyAction } from './engine.js';
import type { CardInstance, GameState, PlayerIndex } from './state.js';

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), size - 1)) out.push([item, ...rest]);
  });
  return out;
}

/** Every plausible action for `player`; callers must still check legality. */
function candidates(catalog: CardCatalog, state: GameState, player: PlayerIndex): Action[] {
  const me = state.players[player];
  const out: Action[] = [];

  if (state.phase === 'setup' && state.setup) {
    const setup = state.setup;
    if (!setup.extraDrawResolved[player]) {
      for (let n = 0; n <= setup.extraDrawAvailable[player]; n++) {
        out.push({ type: 'SETUP_DRAW_EXTRA', count: n });
      }
    } else if (!setup.placed[player]) {
      const basics = me.hand.filter((c) => isBasicCreature(getCard(catalog, c.cardId)));
      for (const active of basics) {
        const bench = basics.filter((c) => c.iid !== active.iid).slice(0, 5);
        out.push({ type: 'SETUP_PLACE', active: active.iid, bench: bench.map((c) => c.iid) });
        out.push({ type: 'SETUP_PLACE', active: active.iid, bench: [] });
      }
    }
    return out;
  }
  if (state.phase !== 'playing') return out;

  for (let i = 0; i < me.bench.length; i++) out.push({ type: 'PROMOTE', benchIndex: i });

  const refs: CreatureRef[] = [];
  if (me.active) refs.push({ zone: 'active' });
  me.bench.forEach((_, index) => refs.push({ zone: 'bench', index }));

  for (const card of me.hand) {
    const def = getCard(catalog, card.cardId);
    if (def.kind === 'creature' && def.stage === 'basic') {
      out.push({ type: 'PLAY_BASIC', iid: card.iid });
    } else if (def.kind === 'creature') {
      for (const target of refs) out.push({ type: 'EVOLVE', iid: card.iid, target });
    } else if (def.kind === 'power') {
      for (const target of refs) out.push({ type: 'ATTACH_POWER', iid: card.iid, target });
    } else {
      out.push({ type: 'PLAY_ITEM', iid: card.iid });
      for (const target of refs) out.push({ type: 'PLAY_ITEM', iid: card.iid, params: { target } });
    }
  }

  for (const target of refs) {
    out.push({ type: 'USE_ABILITY', target });
    for (const t of refs) out.push({ type: 'USE_ABILITY', target, params: { target: t } });
  }

  if (me.active) {
    const attached: CardInstance[] = me.active.attached.slice(0, 8);
    for (let index = 0; index < me.bench.length; index++) {
      for (let size = 0; size <= 3; size++) {
        for (const subset of combinations(attached, size)) {
          out.push({ type: 'RETREAT', benchIndex: index, discard: subset.map((c) => c.iid) });
        }
      }
    }
    for (let attackIndex = 0; attackIndex < 6; attackIndex++) out.push({ type: 'ATTACK', attackIndex });
  }
  out.push({ type: 'END_TURN' });
  return out;
}

/**
 * All actions `player` could legally take right now (setup, promotions and
 * main-phase actions). Each candidate is validated by running it through
 * `applyAction`, so this can never disagree with the engine. Meant for bots,
 * the CLI and UI hints, not for hot loops.
 */
export function legalActions(
  catalog: CardCatalog,
  state: GameState,
  player: PlayerIndex,
  effects: EffectRegistry = defaultEffects,
): Action[] {
  return candidates(catalog, state, player).filter(
    (action) => applyAction(catalog, state, player, action, effects).ok,
  );
}
