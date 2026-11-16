import { creatureCard, type Action, type CardCatalog } from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';
import {
  attackCheck,
  canActInMainPhase,
  creatureAt,
  evolveTargets,
  mustPromote,
  retreatCheck,
  retreatCostOf,
  retreatPaymentError,
} from '../game/hints.js';
import {
  NONE,
  beginAbilityTarget,
  beginPicking,
  beginRetreat,
  creatureHasTargetedAbility,
  handCardNeedsTarget,
  toggleDiscard,
  type Selection,
} from '../game/interaction.js';
import { cardSummary } from '../deck/editor.js';
import { PowerChip } from './parts.js';

/** The contextual box: what can be done with whatever is selected right now. */
export function ActionPanel({
  view,
  catalog,
  selection,
  setSelection,
  send,
}: {
  view: PlayerView;
  catalog: CardCatalog;
  selection: Selection;
  setSelection(s: Selection): void;
  send(action: Action): void;
}) {
  const myMain = canActInMainPhase(view);

  if (mustPromote(view)) {
    return (
      <div className="panel" data-testid="panel-promote">
        <h3>Choose a new active creature</h3>
        <p>Your active creature was knocked out. Click a creature on your bench.</p>
      </div>
    );
  }

  const act = (action: Action) => {
    send(action);
    setSelection(NONE);
  };

  // ---------- a card in hand ----------
  if (selection.kind === 'hand') {
    const card = view.you.hand.find((c) => c.iid === selection.iid);
    const def = card ? catalog[card.cardId] : undefined;
    if (!card || !def) return null;
    const cancel = (
      <button type="button" onClick={() => setSelection(NONE)}>
        Cancel
      </button>
    );

    let body;
    if (selection.picking) {
      body = (
        <p data-testid="picking-hint">
          {def.kind === 'power' && 'Click the creature to attach it to.'}
          {def.kind === 'creature' &&
            (evolveTargets(catalog, view, def).length > 0
              ? 'Click the creature to evolve.'
              : 'No creature of yours can evolve into this card right now.')}
          {def.kind === 'item' && 'Click the creature to use it on.'}
        </p>
      );
    } else if (def.kind === 'creature' && def.stage === 'basic') {
      body = (
        <button
          type="button"
          className="primary"
          disabled={!myMain || view.you.bench.length >= 5}
          onClick={() => act({ type: 'PLAY_BASIC', iid: card.iid })}
          data-testid="play-basic"
        >
          Play to the bench
        </button>
      );
    } else if (handCardNeedsTarget(catalog, def.id)) {
      const label = def.kind === 'power' ? 'Attach to a creature…' : def.kind === 'creature' ? 'Evolve a creature…' : 'Use on a creature…';
      const blocked = !myMain || (def.kind === 'power' && view.you.powerAttachedThisTurn);
      body = (
        <button type="button" className="primary" disabled={blocked} onClick={() => setSelection(beginPicking(selection))} data-testid="pick-target">
          {label}
        </button>
      );
    } else {
      body = (
        <button type="button" className="primary" disabled={!myMain} onClick={() => act({ type: 'PLAY_ITEM', iid: card.iid })} data-testid="play-item">
          Play
        </button>
      );
    }
    return (
      <div className="panel" data-testid="panel-hand">
        <h3>{def.name}</h3>
        <p className="muted">{cardSummary(def)}</p>
        {!myMain && <p className="muted small">You can only play cards on your own turn.</p>}
        {def.kind === 'power' && view.you.powerAttachedThisTurn && myMain && (
          <p className="muted small">You already attached a power card this turn.</p>
        )}
        <div className="row">
          {body}
          {cancel}
        </div>
      </div>
    );
  }

  // ---------- one of my creatures ----------
  if (selection.kind === 'creature') {
    const creature = creatureAt(view, selection.ref);
    if (!creature) return null;
    const card = creatureCard(catalog, creature);
    const isActive = selection.ref.zone === 'active';

    if (selection.mode === 'pickAbilityTarget') {
      return (
        <div className="panel" data-testid="panel-ability-target">
          <h3>{card.ability?.name}</h3>
          <p>Click the creature to use it on.</p>
          <button type="button" onClick={() => setSelection(NONE)}>
            Cancel
          </button>
        </div>
      );
    }

    if (selection.mode === 'retreat') {
      const problem = retreatPaymentError(catalog, creature, selection.discard);
      const ready = problem === null && selection.benchIndex !== null;
      return (
        <div className="panel" data-testid="panel-retreat">
          <h3>Retreat {card.name}</h3>
          <p>
            Retreat cost: <strong>{retreatCostOf(catalog, creature)}</strong> power card
            {retreatCostOf(catalog, creature) === 1 ? '' : 's'}. Choose which to discard:
          </p>
          <div className="chips">
            {creature.attached.map((a) => (
              <PowerChip
                key={a.iid}
                card={catalog[a.cardId]}
                selected={selection.discard.includes(a.iid)}
                onClick={() => setSelection(toggleDiscard(selection, a.iid))}
              />
            ))}
            {creature.attached.length === 0 && <span className="muted small">No power cards attached.</span>}
          </div>
          <p>
            Replacement:{' '}
            {selection.benchIndex === null
              ? 'click a creature on your bench.'
              : creatureCard(catalog, view.you.bench[selection.benchIndex]!).name}
          </p>
          {problem && <p className="muted small" data-testid="retreat-problem">{problem}</p>}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!ready}
              onClick={() => act({ type: 'RETREAT', benchIndex: selection.benchIndex!, discard: selection.discard })}
              data-testid="retreat-confirm"
            >
              Retreat
            </button>
            <button type="button" onClick={() => setSelection(NONE)}>
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // menu
    const retreat = retreatCheck(view);
    return (
      <div className="panel" data-testid="panel-creature">
        <h3>{card.name}</h3>
        <p className="muted">
          {card.nature} · {card.hp - creature.damage}/{card.hp} HP
          {card.weakness ? ` · weak to ${card.weakness}` : ''}
          {card.resistance ? ` · resists ${card.resistance}` : ''}
        </p>
        {card.ability && (
          <div className="ability">
            <strong>{card.ability.name}</strong> <span className="muted small">{card.ability.text}</span>
            <div>
              <button
                type="button"
                disabled={!myMain}
                onClick={() =>
                  creatureHasTargetedAbility(catalog, view, selection.ref)
                    ? setSelection(beginAbilityTarget(selection))
                    : act({ type: 'USE_ABILITY', target: selection.ref })
                }
                data-testid="use-ability"
              >
                Use {card.ability.name}
              </button>
            </div>
          </div>
        )}
        {isActive && (
          <>
            <ul className="attacks">
              {card.attacks.map((attack, index) => {
                const check = attackCheck(catalog, view, creature, index);
                return (
                  <li key={attack.name}>
                    <button
                      type="button"
                      className="primary"
                      disabled={!check.ok}
                      onClick={() => act({ type: 'ATTACK', attackIndex: index })}
                      data-testid={`attack-${index}`}
                      title={check.reason}
                    >
                      {attack.name} · {attack.damage}
                    </button>
                    <span className="muted small">
                      {' '}
                      cost {attack.cost.join(' + ')}
                      {check.ok ? '' : ` — ${check.reason}`}
                      {attack.effect ? ` · ${attack.effect.kind === 'custom' ? 'special effect' : attack.effect.kind === 'poison' ? 'poison' : attack.effect.status}${attack.effect.condition ? ' (coin flip)' : ''}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="muted small">An attack ends your turn.</p>
            <button
              type="button"
              disabled={!retreat.ok}
              onClick={() => setSelection(beginRetreat(selection))}
              title={retreat.reason}
              data-testid="begin-retreat"
            >
              Retreat…{retreat.ok ? '' : ` (${retreat.reason})`}
            </button>
          </>
        )}
        <div className="row">
          <button type="button" onClick={() => setSelection(NONE)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel muted" data-testid="panel-idle">
      <p>{myMain ? 'Your turn: select a card from your hand or one of your creatures.' : 'Select a card or creature to look at it.'}</p>
    </div>
  );
}
