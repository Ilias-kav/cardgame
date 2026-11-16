import {
  creatureCard,
  getCard,
  type Action,
  type CardCatalog,
  type CardInstance,
  type CreatureInPlay,
  type CreatureRef,
  type GameEvent,
  type GameState,
  type PlayerIndex,
} from '@cardgame/engine';

export const playerName = (p: PlayerIndex): string => `Player ${p + 1}`;

const cardName = (catalog: CardCatalog, cardId: string): string => getCard(catalog, cardId).name;

function powerSummary(catalog: CardCatalog, attached: readonly CardInstance[]): string {
  if (attached.length === 0) return 'no power';
  const counts = new Map<string, number>();
  for (const a of attached) {
    const label = cardName(catalog, a.cardId).replace(' Power', '');
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(', ');
}

export function creatureLine(catalog: CardCatalog, c: CreatureInPlay): string {
  const card = creatureCard(catalog, c);
  const flags = [c.status, c.poisoned ? 'poisoned' : null].filter(Boolean).join(', ');
  const stages = c.stack.length > 1 ? ` (evolved from ${cardName(catalog, c.stack[0]!.cardId)})` : '';
  return `${card.name}${stages} ${card.hp - c.damage}/${card.hp} HP [${card.nature}] power: ${powerSummary(catalog, c.attached)}${flags ? ` <${flags}>` : ''}`;
}

const refText = (ref: CreatureRef): string =>
  ref.zone === 'active' ? 'the active creature' : `bench slot ${ref.index + 1}`;

function cardOf(state: GameState, player: PlayerIndex, iid: string): CardInstance | undefined {
  const p = state.players[player];
  const inPlay = [p.active, ...p.bench].flatMap((c) => (c ? c.attached : []));
  return [...p.hand, ...inPlay].find((c) => c.iid === iid);
}

export function describeAction(
  catalog: CardCatalog,
  state: GameState,
  player: PlayerIndex,
  action: Action,
): string {
  const n = (iid: string): string => {
    const card = cardOf(state, player, iid);
    return card ? cardName(catalog, card.cardId) : iid;
  };
  switch (action.type) {
    case 'SETUP_DRAW_EXTRA':
      return `Draw ${action.count} extra card(s)`;
    case 'SETUP_PLACE':
      return `Start with ${n(action.active)} active, bench: ${action.bench.map(n).join(', ') || 'nothing'}`;
    case 'PLAY_BASIC':
      return `Play ${n(action.iid)} to the bench`;
    case 'ATTACH_POWER':
      return `Attach ${n(action.iid)} to ${refText(action.target)}`;
    case 'EVOLVE':
      return `Evolve ${refText(action.target)} into ${n(action.iid)}`;
    case 'PLAY_ITEM': {
      const target = action.params?.target as CreatureRef | undefined;
      return `Play ${n(action.iid)}${target ? ` on ${refText(target)}` : ''}`;
    }
    case 'USE_ABILITY': {
      const c = action.target.zone === 'active' ? state.players[player].active : state.players[player].bench[action.target.index];
      const ability = c ? creatureCard(catalog, c).ability?.name : undefined;
      const target = action.params?.target as CreatureRef | undefined;
      return `Use ${ability ?? 'ability'} of ${refText(action.target)}${target ? ` on ${refText(target)}` : ''}`;
    }
    case 'RETREAT': {
      const p = state.players[player];
      const incoming = p.bench[action.benchIndex];
      const discards = action.discard.map(n).join(', ');
      return `Retreat, promoting ${incoming ? creatureCard(catalog, incoming).name : '?'} (slot ${action.benchIndex + 1})${discards ? `, discarding ${discards}` : ''}`;
    }
    case 'ATTACK': {
      const active = state.players[player].active;
      const atk = active ? creatureCard(catalog, active).attacks[action.attackIndex] : undefined;
      return `Attack: ${atk?.name ?? '?'} (${atk?.damage ?? 0} damage, cost ${atk?.cost.join('+') ?? '?'}) and end the turn`;
    }
    case 'END_TURN':
      return 'End turn';
    case 'PROMOTE': {
      const c = state.players[player].bench[action.benchIndex];
      return `Promote ${c ? creatureCard(catalog, c).name : '?'} to active`;
    }
  }
}

export function describeEvent(catalog: CardCatalog, e: GameEvent): string {
  const P = playerName;
  switch (e.type) {
    case 'COIN_FLIP':
      return e.purpose === 'first_player'
        ? `Coin flip: ${e.heads ? 'heads' : 'tails'} - ${P(e.winner)} goes first`
        : `${P(e.player)} flips a coin for ${e.purpose.replace('_', ' ')}: ${e.heads ? 'heads' : 'tails'}`;
    case 'MULLIGAN':
      return `${P(e.player)} has no basic creature and shows their hand (${e.revealedHand.map((c) => cardName(catalog, c)).join(', ')})${e.opponentMayDraw ? '; the opponent may draw extra cards' : ''}`;
    case 'EXTRA_DRAW':
      return `${P(e.player)} draws ${e.count} extra card(s)`;
    case 'SETUP_PLACED':
      return `${P(e.player)} has placed their starting creatures`;
    case 'GAME_STARTED':
      return `The game begins, ${P(e.firstPlayer)} first`;
    case 'TURN_STARTED':
      return `--- Turn ${e.turn}: ${P(e.player)} ---`;
    case 'TURN_ENDED':
      return `${P(e.player)} ends their turn`;
    case 'CARD_DRAWN':
      return `${P(e.player)} draws ${e.count} card(s)`;
    case 'CREATURE_PLAYED':
      return `${P(e.player)} plays ${cardName(catalog, e.cardId)} to the bench`;
    case 'POWER_ATTACHED':
      return `${P(e.player)} attaches ${cardName(catalog, e.cardId)} to ${refText(e.target)}`;
    case 'EVOLVED':
      return `${P(e.player)} evolves ${refText(e.target)} into ${cardName(catalog, e.cardId)}`;
    case 'ITEM_PLAYED':
      return `${P(e.player)} plays ${cardName(catalog, e.cardId)}`;
    case 'ABILITY_USED':
      return `${P(e.player)} uses the ability of ${refText(e.target)}`;
    case 'RETREATED':
      return `${P(e.player)} retreats and promotes bench slot ${e.benchIndex + 1}`;
    case 'RETREAT_FAILED':
      return `${P(e.player)}'s creature is confused and fails to retreat`;
    case 'PROMOTED':
      return `${P(e.player)} promotes bench slot ${e.benchIndex + 1} to active`;
    case 'ATTACK_DECLARED':
      return `${P(e.player)} attacks with ${e.attack}`;
    case 'DAMAGE':
      return `${P(e.player)}'s creature takes ${e.amount} damage (${e.source})`;
    case 'CREATURE_HEALED':
      return `${P(e.player)}'s creature heals ${e.amount}`;
    case 'STATUS_APPLIED':
      return `${P(e.player)}'s creature is now ${e.status}`;
    case 'STATUS_REMOVED':
      return `${P(e.player)}'s creature is no longer ${e.status}`;
    case 'CREATURE_KNOCKED_OUT':
      return `${P(e.player)}'s ${e.cardIds.map((c) => cardName(catalog, c)).join(' / ')} is knocked out!`;
    case 'PRIZE_TAKEN':
      return `${P(e.player)} takes a prize card`;
    case 'GAME_OVER':
      return e.result.winner === null
        ? 'GAME OVER: both players took their last prize - sudden death rematch'
        : `GAME OVER: ${P(e.result.winner)} wins (${e.result.reason.replace('_', ' ')})`;
  }
}

/** The board as `viewer` sees it: own hand visible, opponent's hidden. */
export function renderBoard(catalog: CardCatalog, state: GameState, viewer: PlayerIndex): string {
  const opp: PlayerIndex = viewer === 0 ? 1 : 0;
  const lines: string[] = [];
  const side = (p: PlayerIndex, showHand: boolean): void => {
    const pl = state.players[p];
    lines.push(`${playerName(p)}${p === viewer ? ' (you)' : ''}: deck ${pl.deck.length}, prizes ${pl.prizes.length}, hand ${pl.hand.length}, discard ${pl.discard.length}`);
    lines.push(`  Active: ${pl.active ? creatureLine(catalog, pl.active) : '-'}`);
    pl.bench.forEach((c, i) => lines.push(`  Bench ${i + 1}: ${creatureLine(catalog, c)}`));
    if (showHand) lines.push(`  Hand: ${pl.hand.map((c) => cardName(catalog, c.cardId)).join(', ') || '-'}`);
  };
  side(opp, false);
  lines.push('');
  side(viewer, true);
  return lines.join('\n');
}
