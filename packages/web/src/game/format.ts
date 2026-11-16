import type { CardCatalog, CreatureRef, GameEvent, PlayerIndex } from '@cardgame/engine';
import type { Outcome, OutcomeReason } from '@cardgame/protocol';

export type Tone = 'turn' | 'info' | 'combat' | 'status' | 'result';
export interface LogLine {
  text: string;
  tone: Tone;
}

export interface FormatContext {
  catalog: CardCatalog;
  mySeat: PlayerIndex;
  /** Usernames by seat. */
  names: [string, string];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "attach" -> "attaches", "retreat" -> "retreats". */
export const thirdPerson = (verb: string): string => (/(s|x|z|ch|sh)$/.test(verb) ? `${verb}es` : `${verb}s`);

function refText(ref: CreatureRef): string {
  return ref.zone === 'active' ? 'the active creature' : `bench slot ${ref.index + 1}`;
}

const COIN_PURPOSE: Record<string, string> = {
  attack_effect: 'an attack effect',
  confusion_attack: 'a confused attack',
  confusion_retreat: 'a confused retreat',
  sleep_wake: 'waking up',
};

export const REASON_TEXT: Record<OutcomeReason, string> = {
  prizes: 'all prize cards were taken',
  no_creatures: 'no creatures were left in play',
  deck_out: 'a player could not draw a card',
  forfeit: 'a player gave up',
  timeout: 'a player ran out of time',
  disconnect: 'a player left and did not come back in time',
  abandoned: 'nobody was playing any more',
  sudden_death_rematch: 'both players took their last prize at once',
};

export function describeOutcome(outcome: Outcome, mySeat: PlayerIndex, names: [string, string]): string {
  if (outcome.reason === 'sudden_death_rematch') return `Sudden death! ${REASON_TEXT[outcome.reason]}.`;
  if (outcome.winner === null) return `No winner: ${REASON_TEXT[outcome.reason]}.`;
  const who = outcome.winner === mySeat ? 'You win' : `${names[outcome.winner]} wins`;
  return `${who}: ${REASON_TEXT[outcome.reason]}.`;
}

/** One human-readable line for a game event, or null for events not worth showing. */
export function formatEvent(e: GameEvent, ctx: FormatContext): LogLine | null {
  const { catalog, mySeat, names } = ctx;
  const card = (id: string) => catalog[id]?.name ?? id;
  const who = (p: PlayerIndex) => (p === mySeat ? 'You' : names[p]);
  const whose = (p: PlayerIndex) => (p === mySeat ? 'Your' : `${names[p]}'s`);
  /** Verb agreement: "You draw" / "bob draws" / "bob attaches". */
  const verb = (p: PlayerIndex, base: string) => (p === mySeat ? base : thirdPerson(base));
  const info = (text: string): LogLine => ({ text, tone: 'info' });

  switch (e.type) {
    case 'COIN_FLIP':
      if (e.purpose === 'first_player') {
        return info(`Coin flip: ${e.heads ? 'heads' : 'tails'}. ${who(e.winner)} ${e.winner === mySeat ? 'go' : 'goes'} first.`);
      }
      return { text: `${who(e.player)} ${verb(e.player, 'flip')} a coin for ${COIN_PURPOSE[e.purpose] ?? e.purpose}: ${e.heads ? 'heads' : 'tails'}.`, tone: 'status' };
    case 'MULLIGAN':
      return info(
        `${who(e.player)} had no basic creature and ${verb(e.player, 'show')} ${e.player === mySeat ? 'your' : 'their'} hand (${e.revealedHand.map(card).join(', ')}).${e.opponentMayDraw ? ' The opponent may draw 2 extra cards.' : ''}`,
      );
    case 'EXTRA_DRAW':
      return info(
        e.count === 0
          ? `${who(e.player)} chose not to draw extra cards.`
          : `${who(e.player)} ${verb(e.player, 'draw')} ${plural(e.count, 'extra card')}.`,
      );
    case 'SETUP_PLACED':
      return info(`${who(e.player)} ${e.player === mySeat ? 'have' : 'has'} placed ${e.player === mySeat ? 'your' : 'their'} starting creatures.`);
    case 'GAME_STARTED':
      return null; // the coin flip line already says who starts
    case 'TURN_STARTED':
      return { text: `Turn ${e.turn}: ${e.player === mySeat ? 'your turn' : `${names[e.player]}'s turn`}`, tone: 'turn' };
    case 'TURN_ENDED':
      return null;
    case 'CARD_DRAWN':
      return info(`${who(e.player)} ${verb(e.player, 'draw')} ${plural(e.count, 'card')}.`);
    case 'CREATURE_PLAYED':
      return info(`${who(e.player)} ${verb(e.player, 'play')} ${card(e.cardId)} to the bench.`);
    case 'POWER_ATTACHED':
      return info(`${who(e.player)} ${verb(e.player, 'attach')} ${card(e.cardId)} to ${refText(e.target)}.`);
    case 'EVOLVED':
      return info(`${who(e.player)} ${verb(e.player, 'evolve')} ${refText(e.target)} into ${card(e.cardId)}.`);
    case 'ITEM_PLAYED':
      return info(`${who(e.player)} ${verb(e.player, 'play')} ${card(e.cardId)}.`);
    case 'ABILITY_USED':
      return info(`${who(e.player)} ${verb(e.player, 'use')} the ability of ${refText(e.target)}.`);
    case 'RETREATED':
      return info(`${who(e.player)} ${verb(e.player, 'retreat')} and ${verb(e.player, 'promote')} bench slot ${e.benchIndex + 1}.`);
    case 'RETREAT_FAILED':
      return { text: `${whose(e.player)} creature is confused and fails to retreat.`, tone: 'status' };
    case 'PROMOTED':
      return info(`${who(e.player)} ${verb(e.player, 'promote')} bench slot ${e.benchIndex + 1} to active.`);
    case 'ATTACK_DECLARED':
      return { text: `${who(e.player)} ${verb(e.player, 'attack')} with ${e.attack}!`, tone: 'combat' };
    case 'DAMAGE': {
      const why = e.source === 'poison' ? ' from poison' : e.source === 'confusion' ? ' from confusion' : '';
      return { text: `${whose(e.player)} creature takes ${e.amount} damage${why}.`, tone: 'combat' };
    }
    case 'CREATURE_HEALED':
      return info(`${whose(e.player)} creature heals ${e.amount} damage.`);
    case 'STATUS_APPLIED':
      return { text: `${whose(e.player)} creature is now ${e.status}.`, tone: 'status' };
    case 'STATUS_REMOVED':
      return { text: `${whose(e.player)} creature is no longer ${e.status}.`, tone: 'status' };
    case 'CREATURE_KNOCKED_OUT':
      return { text: `${whose(e.player)} ${e.cardIds.map(card).join(' / ')} is knocked out!`, tone: 'combat' };
    case 'PRIZE_TAKEN':
      return info(`${who(e.player)} ${verb(e.player, 'take')} a prize card.`);
    case 'GAME_OVER':
      return { text: describeOutcome(
        e.result.winner === null
          ? { winner: null, reason: 'sudden_death_rematch' }
          : { winner: e.result.winner, reason: e.result.reason },
        mySeat,
        names,
      ), tone: 'result' };
  }
}
