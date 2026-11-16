# Game rules (source of truth for the engine)

Status: card values, abilities and effects are **not** decided yet. Items marked
**ASSUMPTION** are my defaults and need the designer's confirmation.

## Overview

- Two-player duel. Each player has a deck of exactly **60 cards**.
- Card types: **creature**, **item**, **power**.
- Max **4 copies** of any individual card per deck. Power cards are unlimited,
  except **double neutral**, which counts as 2 neutral power cards, is otherwise
  not treated as a power card, and is therefore limited to 4 copies.
- ASSUMPTION: a deck must contain at least one basic creature (otherwise the game can't start).

## Cards

**Creature**: name, hit points, optional ability, one or more attacks, nature,
optional weakness (a nature), optional resistance (a nature), retreat cost
(number of power cards to discard). Stage: basic, stage 1, stage 2.

**Attack**: damage, power cost (number and type of power cards attached), optional effect.
A cost may include neutral symbols; any power card can pay a neutral symbol.
An effect may need a condition (usually one or more successful coin flips).

**Power types**: fire, water, leaf, ground, lightning, soul, neutral.
Creatures also have one of these as their nature. Neutral does not exist as a
card; any power card can stand in for it.

### Evolution

- A stage 1 can only be placed on top of the basic creature it relates to; a stage 2 only on top of that stage 1.
- Attached cards and damage stay. Attacks, ability, hit points, weakness and
  resistance are replaced by the higher stage's card.
- A creature cannot evolve on the turn it was played.
- A successful evolution clears status (asleep/paralyzed/confused/poison; see Statuses).

## Battlefield (per player)

One active creature, up to 5 benched creatures, a discard pile, the deck (face
down), and 6 prize cards (face down).

## Setup

1. Coin flip; the winner goes first.
2. Shuffle both decks, place 6 prize cards face down, each player draws 7.
3. A player with no basic creature in hand shows their hand, shuffles it back
   into the deck and draws 7 again. The opponent **may** draw 2 extra cards each
   time. Repeat as needed.
4. If neither player has a basic, both shuffle and redraw with no extra cards.
5. Each player places one basic as active and may place more basics on the bench.

## Winning

A player wins when any of these happens:

- they have taken all their prize cards;
- the opponent has no creature in play (active or bench);
- the opponent has no card left to draw at the start of their turn.

Simultaneous results:

- Both players lose their last creature at once: the player with **fewer prize
  cards left** wins. (ASSUMPTION: equal prizes -> sudden death as below.)
- Both take their last prize at once: **sudden death**, a new game with the same
  rules but only **1 prize card**.

## Turn structure

1. **Start of turn: draw a card.** This also applies to the very first turn of the first player.
2. **Main phase**: any of the following, any number of times, in any order,
   unless limited:
   - play a basic creature from hand onto the bench (max 5);
   - attach **one** power card to a creature (active or benched) per turn;
   - activate a creature ability;
   - evolve a creature (not one played this turn);
   - play item cards (no limit per turn);
   - retreat the active creature (no limit per turn): discard power cards equal
     to the retreat cost, then promote a benched creature.
3. **End of turn**: an optional **attack** by the active creature, if the
   required power cards are attached. The **first player may attack on their first turn.**

## Attacking and knockouts

- Damage is subtracted from the target's current hit points; weakness and
  resistance apply. ASSUMPTION: weakness x2, resistance -30 (see `rules.ts`).
- If hit points reach 0 or less, the creature is knocked out: all its cards
  (evolution stack, attached power cards) go to the discard pile.
- The attacker takes **exactly 1 prize card into their hand**.
- The defender promotes a benched creature to active.

## Statuses

A creature has at most one of **asleep / paralyzed / confused** (a new one
replaces the old). **Poison** is independent and can coexist with them.

| Status    | Effect |
|-----------|--------|
| Asleep    | Right before the owner's turn they flip a coin: heads = wakes up. While asleep it cannot attack or retreat. |
| Paralyzed | Cannot attack or retreat. Cleared after the paralyzed player's next turn. |
| Confused  | To attack or retreat, flip a coin. Tails on attack: no attack and the creature deals 20 damage to itself (weakness/resistance apply). Tails on retreat: the retreat cost is paid but the creature does not retreat. |
| Poisoned  | Between turns the creature takes 10 damage (no weakness/resistance). |

A **successful evolution or retreat clears status**.

## Implementation decisions (made while building phases 2-3)

These fill gaps in the written rules; change them in `rules.ts` / `turn.ts` if wrong.

- An **attack ends the turn** (after damage, effects and any knockout). A player may also end the turn with END_TURN without attacking.
- **Between-turns checkup** runs after every turn, for the active creatures of both players (the player whose turn just ended first): 1) poison damage (both players), 2) sleep: only the player whose turn is about to start flips for wake-up, 3) paralysis of the player whose turn just ended wears off.
- **Paralysis** therefore survives the checkup right after it is inflicted and wears off at the end of the paralyzed player's own turn.
- **Confusion self-damage** is 20, modified by the confused creature's own weakness/resistance, using its own nature as the damage type.
- A creature **cannot evolve twice in one turn**. Creatures placed during setup can evolve on turn 1.
- **Abilities** have no built-in usage limit; a handler enforces its own.
- After a knockout the taker may choose any face-down prize; since they were dealt at random the engine simply takes the top one (no action needed).
- Poison knockouts at the checkup give the opponent a prize and a promotion, like attack knockouts.
- **Simultaneous win conditions**: when both players satisfy one, fewer prizes left wins; equal = sudden-death rematch.
- Statuses only exist on the active creature; poison is also cleared by evolving and by a successful retreat.

## Open questions

- Confirm the ASSUMPTION items above (weakness/resistance values, equal-prize tie on double knockout, mandatory basic in deck).
