import type {
  AttackDef,
  Card,
  CardCatalog,
  CostSymbol,
  CreatureCard,
  Nature,
  PowerType,
} from '../cards.js';
import type { DeckEntry } from '../deck.js';

/**
 * PLACEHOLDER card set for development and testing. Names, numbers and effects
 * are made up and will be replaced once the real cards are designed.
 */

const atk = (name: string, damage: number, cost: CostSymbol[], effect?: AttackDef['effect']): AttackDef =>
  effect ? { name, damage, cost, effect } : { name, damage, cost };

interface CreatureSpec {
  id: string;
  name: string;
  stage: CreatureCard['stage'];
  evolvesFrom?: string;
  hp: number;
  nature: Nature;
  weakness?: Nature;
  resistance?: Nature;
  retreatCost: number;
  ability?: CreatureCard['ability'];
  attacks: AttackDef[];
}

const creature = (c: CreatureSpec): CreatureCard => ({ kind: 'creature', ...c });

const power = (type: PowerType, name: string): Card => ({
  kind: 'power',
  id: `power-${type}`,
  name,
  power: type,
});

const creatures: CreatureCard[] = [
  // Fire line
  creature({ id: 'embercub', name: 'Embercub', stage: 'basic', hp: 50, nature: 'fire', weakness: 'water', resistance: 'leaf', retreatCost: 1,
    attacks: [atk('Scratch', 10, ['neutral']), atk('Flame Burst', 30, ['fire', 'neutral'])] }),
  creature({ id: 'blazewolf', name: 'Blazewolf', stage: 'stage1', evolvesFrom: 'Embercub', hp: 80, nature: 'fire', weakness: 'water', resistance: 'leaf', retreatCost: 2,
    attacks: [atk('Bite', 30, ['fire']), atk('Scorch', 50, ['fire', 'fire', 'neutral'], { kind: 'status', status: 'confused', condition: { flips: 1, needed: 1 } })] }),
  creature({ id: 'infernowolf', name: 'Infernowolf', stage: 'stage2', evolvesFrom: 'Blazewolf', hp: 130, nature: 'fire', weakness: 'water', resistance: 'leaf', retreatCost: 3,
    attacks: [atk('Inferno', 100, ['fire', 'fire', 'fire', 'neutral'])] }),
  // Water line
  creature({ id: 'pondling', name: 'Pondling', stage: 'basic', hp: 50, nature: 'water', weakness: 'leaf', resistance: 'fire', retreatCost: 1,
    attacks: [atk('Bubble', 10, ['water']), atk('Splash', 30, ['water', 'neutral'])] }),
  creature({ id: 'tidewyrm', name: 'Tidewyrm', stage: 'stage1', evolvesFrom: 'Pondling', hp: 80, nature: 'water', weakness: 'leaf', resistance: 'fire', retreatCost: 2,
    attacks: [atk('Wave', 40, ['water', 'neutral']), atk('Undertow', 20, ['water', 'water'], { kind: 'status', status: 'asleep', condition: { flips: 1, needed: 1 } })] }),
  creature({ id: 'leviathor', name: 'Leviathor', stage: 'stage2', evolvesFrom: 'Tidewyrm', hp: 130, nature: 'water', weakness: 'leaf', resistance: 'fire', retreatCost: 3,
    attacks: [atk('Tsunami', 90, ['water', 'water', 'neutral']), atk('Deluge', 120, ['water', 'water', 'water', 'neutral'])] }),
  // Leaf line
  creature({ id: 'sproutle', name: 'Sproutle', stage: 'basic', hp: 40, nature: 'leaf', weakness: 'fire', resistance: 'ground', retreatCost: 1,
    attacks: [atk('Vine Whip', 10, ['leaf']), atk('Spore', 10, ['leaf', 'neutral'], { kind: 'poison' })] }),
  creature({ id: 'thornback', name: 'Thornback', stage: 'stage1', evolvesFrom: 'Sproutle', hp: 70, nature: 'leaf', weakness: 'fire', resistance: 'ground', retreatCost: 2,
    attacks: [atk('Thorn Volley', 30, ['leaf', 'neutral']), atk('Toxic Sting', 30, ['leaf', 'leaf'], { kind: 'poison' })] }),
  creature({ id: 'mender', name: 'Mender', stage: 'basic', hp: 50, nature: 'leaf', weakness: 'fire', resistance: 'ground', retreatCost: 1,
    ability: { name: 'Soothe', text: 'Heal 10 damage from one of your creatures.', effect: { handler: 'heal', params: { amount: 10 } } },
    attacks: [atk('Nibble', 10, ['neutral'])] }),
  // Ground line
  creature({ id: 'pebbleton', name: 'Pebbleton', stage: 'basic', hp: 60, nature: 'ground', weakness: 'leaf', resistance: 'lightning', retreatCost: 2,
    attacks: [atk('Tackle', 10, ['neutral']), atk('Rock Throw', 30, ['ground', 'neutral'])] }),
  creature({ id: 'boulderback', name: 'Boulderback', stage: 'stage1', evolvesFrom: 'Pebbleton', hp: 100, nature: 'ground', weakness: 'leaf', resistance: 'lightning', retreatCost: 3,
    attacks: [atk('Landslide', 60, ['ground', 'ground', 'neutral'])] }),
  // Lightning line
  creature({ id: 'voltmouse', name: 'Voltmouse', stage: 'basic', hp: 40, nature: 'lightning', weakness: 'ground', retreatCost: 0,
    attacks: [atk('Zap', 10, ['lightning']), atk('Static Shock', 20, ['lightning', 'neutral'], { kind: 'status', status: 'paralyzed', condition: { flips: 1, needed: 1 } })] }),
  creature({ id: 'stormfox', name: 'Stormfox', stage: 'stage1', evolvesFrom: 'Voltmouse', hp: 70, nature: 'lightning', weakness: 'ground', retreatCost: 1,
    attacks: [atk('Thunder Fang', 40, ['lightning', 'neutral']), atk('Overload', 70, ['lightning', 'lightning', 'neutral'])] }),
  // Soul line
  creature({ id: 'wispling', name: 'Wispling', stage: 'basic', hp: 40, nature: 'soul', weakness: 'soul', retreatCost: 1,
    attacks: [atk('Whisper', 10, ['soul']), atk('Lull', 0, ['soul', 'neutral'], { kind: 'status', status: 'asleep' })] }),
  creature({ id: 'phantomane', name: 'Phantomane', stage: 'stage1', evolvesFrom: 'Wispling', hp: 70, nature: 'soul', weakness: 'soul', retreatCost: 1,
    attacks: [atk('Haunt', 30, ['soul', 'neutral'], { kind: 'status', status: 'confused' }), atk('Soul Drain', 60, ['soul', 'soul', 'neutral'])] }),
  // Neutral creatures
  creature({ id: 'plainsbeast', name: 'Plainsbeast', stage: 'basic', hp: 70, nature: 'neutral', retreatCost: 2,
    attacks: [atk('Headbutt', 20, ['neutral', 'neutral']), atk('Stampede', 50, ['neutral', 'neutral', 'neutral'])] }),
  creature({ id: 'dozer', name: 'Dozer', stage: 'basic', hp: 60, nature: 'neutral', retreatCost: 1,
    attacks: [atk('Yawn', 10, ['neutral'], { kind: 'status', status: 'asleep', condition: { flips: 1, needed: 1 } }), atk('Sleepy Slam', 30, ['neutral', 'neutral'])] }),
  creature({ id: 'tricksy', name: 'Tricksy', stage: 'basic', hp: 50, nature: 'neutral', retreatCost: 1,
    attacks: [atk('Prank', 20, ['neutral'], { kind: 'status', status: 'confused', condition: { flips: 2, needed: 1 } }), atk('Double Trouble', 40, ['neutral', 'neutral', 'neutral'], { kind: 'poison', condition: { flips: 2, needed: 2 } })] }),
];

const others: Card[] = [
  { kind: 'item', id: 'potion', name: 'Potion', text: 'Heal 20 damage from one of your creatures.', effect: { handler: 'heal', params: { amount: 20 } } },
  { kind: 'item', id: 'super-potion', name: 'Super Potion', text: 'Heal 40 damage from one of your creatures.', effect: { handler: 'heal', params: { amount: 40 } } },
  { kind: 'item', id: 'quick-draw', name: 'Quick Draw', text: 'Draw 2 cards.', effect: { handler: 'draw', params: { count: 2 } } },
  { kind: 'item', id: 'deep-study', name: 'Deep Study', text: 'Draw 3 cards.', effect: { handler: 'draw', params: { count: 3 } } },
  power('fire', 'Fire Power'),
  power('water', 'Water Power'),
  power('leaf', 'Leaf Power'),
  power('ground', 'Ground Power'),
  power('lightning', 'Lightning Power'),
  power('soul', 'Soul Power'),
  { kind: 'power', id: 'power-double-neutral', name: 'Double Neutral Power', power: 'doubleNeutral' },
];

export const starterCatalog: CardCatalog = Object.fromEntries(
  [...creatures, ...others].map((card) => [card.id, card]),
);

const deck = (entries: Array<[string, number]>, powerId: string, powerCount: number): DeckEntry[] => [
  ...entries.map(([cardId, count]) => ({ cardId, count })),
  { cardId: powerId, count: powerCount },
];

/** Ready-made 60-card decks (each is checked by a test). */
export const starterDecks: Record<string, DeckEntry[]> = {
  fire: deck(
    [['embercub', 4], ['blazewolf', 3], ['infernowolf', 2], ['plainsbeast', 3], ['tricksy', 2],
     ['potion', 4], ['quick-draw', 4], ['power-double-neutral', 4]],
    'power-fire', 34,
  ),
  water: deck(
    [['pondling', 4], ['tidewyrm', 3], ['leviathor', 2], ['dozer', 3], ['pebbleton', 2],
     ['super-potion', 3], ['deep-study', 3], ['power-double-neutral', 4]],
    'power-water', 36,
  ),
  leaf: deck(
    [['sproutle', 4], ['thornback', 4], ['mender', 3], ['wispling', 2], ['phantomane', 2],
     ['potion', 4], ['quick-draw', 3], ['power-double-neutral', 4]],
    'power-leaf', 34,
  ),
  storm: deck(
    [['voltmouse', 4], ['stormfox', 4], ['pebbleton', 2], ['boulderback', 2], ['wispling', 2],
     ['potion', 4], ['super-potion', 2], ['power-double-neutral', 4]],
    'power-lightning', 36,
  ),
};
