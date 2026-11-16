import type { Action, CardCatalog, CreatureRef } from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';
import {
  abilityNeedsTarget,
  evolveTargets,
  itemNeedsTarget,
  mustPromote,
  myCreatures,
  sameRef,
} from './hints.js';
import { creatureCard } from '@cardgame/engine';

/** What the player currently has selected on the game screen. */
export type Selection =
  | { kind: 'none' }
  /** A card in hand. `picking`: waiting for them to click the creature it should go to. */
  | { kind: 'hand'; iid: string; picking: boolean }
  | {
      kind: 'creature';
      ref: CreatureRef;
      /** menu: attacks/ability/retreat buttons; pickAbilityTarget: choose whom the ability affects; retreat: choose payment and replacement */
      mode: 'menu' | 'pickAbilityTarget' | 'retreat';
      /** iids of attached power cards chosen to pay the retreat cost */
      discard: string[];
      /** bench slot chosen to take over when retreating */
      benchIndex: number | null;
    };

export const NONE: Selection = { kind: 'none' };

export interface ClickResult {
  selection: Selection;
  /** A move to send to the server (the selection is then cleared). */
  action?: Action;
  /** Something to tell the player (e.g. why the click did nothing). */
  message?: string;
}

export function clickHandCard(sel: Selection, iid: string): ClickResult {
  if (sel.kind === 'hand' && sel.iid === iid) return { selection: NONE };
  return { selection: { kind: 'hand', iid, picking: false } };
}

/** The "Attach / Evolve / Use on a creature" button was pressed for the selected hand card. */
export function beginPicking(sel: Selection): Selection {
  return sel.kind === 'hand' ? { ...sel, picking: true } : sel;
}

export function beginRetreat(sel: Selection): Selection {
  return sel.kind === 'creature' ? { ...sel, mode: 'retreat', discard: [], benchIndex: null } : sel;
}

export function beginAbilityTarget(sel: Selection): Selection {
  return sel.kind === 'creature' ? { ...sel, mode: 'pickAbilityTarget' } : sel;
}

export function toggleDiscard(sel: Selection, iid: string): Selection {
  if (sel.kind !== 'creature' || sel.mode !== 'retreat') return sel;
  const discard = sel.discard.includes(iid) ? sel.discard.filter((d) => d !== iid) : [...sel.discard, iid];
  return { ...sel, discard };
}

export function clickMyCreature(view: PlayerView, catalog: CardCatalog, sel: Selection, ref: CreatureRef): ClickResult {
  // A knocked-out active creature must be replaced from the bench first.
  if (mustPromote(view)) {
    if (ref.zone === 'bench') return { selection: NONE, action: { type: 'PROMOTE', benchIndex: ref.index } };
    return { selection: sel, message: 'Choose a creature from your bench to promote.' };
  }

  if (sel.kind === 'hand' && sel.picking) {
    const card = view.you.hand.find((c) => c.iid === sel.iid);
    const def = card ? catalog[card.cardId] : undefined;
    if (!card || !def) return { selection: NONE };
    if (def.kind === 'power') {
      return { selection: NONE, action: { type: 'ATTACH_POWER', iid: card.iid, target: ref } };
    }
    if (def.kind === 'creature') {
      if (!evolveTargets(catalog, view, def).some((t) => sameRef(t, ref))) {
        return { selection: sel, message: `That creature cannot evolve into ${def.name}.` };
      }
      return { selection: NONE, action: { type: 'EVOLVE', iid: card.iid, target: ref } };
    }
    return { selection: NONE, action: { type: 'PLAY_ITEM', iid: card.iid, params: { target: ref } } };
  }

  if (sel.kind === 'creature' && sel.mode === 'pickAbilityTarget') {
    return { selection: NONE, action: { type: 'USE_ABILITY', target: sel.ref, params: { target: ref } } };
  }

  if (sel.kind === 'creature' && sel.mode === 'retreat') {
    if (ref.zone !== 'bench') return { selection: sel };
    return { selection: { ...sel, benchIndex: sel.benchIndex === ref.index ? null : ref.index } };
  }

  if (sel.kind === 'creature' && sameRef(sel.ref, ref)) return { selection: NONE };
  return { selection: { kind: 'creature', ref, mode: 'menu', discard: [], benchIndex: null } };
}

/** Which of my creatures to highlight as clickable targets. */
export function targetsFor(view: PlayerView, catalog: CardCatalog, sel: Selection): CreatureRef[] {
  const bench = (): CreatureRef[] => view.you.bench.map((_, index) => ({ zone: 'bench', index }));
  if (mustPromote(view)) return bench();
  if (sel.kind === 'hand' && sel.picking) {
    const card = view.you.hand.find((c) => c.iid === sel.iid);
    const def = card ? catalog[card.cardId] : undefined;
    if (!def) return [];
    if (def.kind === 'creature') return evolveTargets(catalog, view, def);
    return myCreatures(view).map((c) => c.ref);
  }
  if (sel.kind === 'creature' && sel.mode === 'pickAbilityTarget') return myCreatures(view).map((c) => c.ref);
  if (sel.kind === 'creature' && sel.mode === 'retreat') return bench();
  return [];
}

/** Does playing this hand card need a target creature? */
export function handCardNeedsTarget(catalog: CardCatalog, cardId: string): boolean {
  const def = catalog[cardId];
  if (!def) return false;
  return def.kind === 'power' || def.kind === 'creature' || itemNeedsTarget(def);
}

export function creatureHasTargetedAbility(catalog: CardCatalog, view: PlayerView, ref: CreatureRef): boolean {
  const c = ref.zone === 'active' ? view.you.active : view.you.bench[ref.index];
  return c ? abilityNeedsTarget(creatureCard(catalog, c)) : false;
}

/** Drops a selection that no longer makes sense after the game state changed. */
export function validateSelection(view: PlayerView, sel: Selection): Selection {
  if (sel.kind === 'hand' && !view.you.hand.some((c) => c.iid === sel.iid)) return NONE;
  if (sel.kind === 'creature') {
    const c = sel.ref.zone === 'active' ? view.you.active : view.you.bench[sel.ref.index];
    if (!c) return NONE;
    if (sel.mode === 'retreat') {
      const attached = new Set(c.attached.map((a) => a.iid));
      const discard = sel.discard.filter((d) => attached.has(d));
      const benchIndex = sel.benchIndex !== null && view.you.bench[sel.benchIndex] ? sel.benchIndex : null;
      if (discard.length !== sel.discard.length || benchIndex !== sel.benchIndex) return { ...sel, discard, benchIndex };
    }
  }
  return sel;
}
