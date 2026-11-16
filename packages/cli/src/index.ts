import { createInterface } from 'node:readline';
import process from 'node:process';
import {
  Rng,
  applyAction,
  chooseAction,
  createGame,
  legalActions,
  simulateGame,
  starterCatalog,
  starterDecks,
  type Action,
  type PlayerIndex,
  type Transition,
} from '@cardgame/engine';
import { describeAction, describeEvent, playerName, renderBoard } from './format.js';

const catalog = starterCatalog;
const deckNames = Object.keys(starterDecks);

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function pickDeck(name: string | undefined, fallbackIndex: number) {
  const key = name ?? deckNames[fallbackIndex % deckNames.length]!;
  const deck = starterDecks[key];
  if (!deck) {
    console.error(`Unknown deck "${key}". Available: ${deckNames.join(', ')}`);
    process.exit(1);
  }
  return { key, deck };
}

function usage(): never {
  console.log(`Usage:
  pnpm --filter @cardgame/cli watch [--seed N] [--deck1 fire] [--deck2 water]
  pnpm --filter @cardgame/cli play  [--seed N] [--deck fire] [--vs water]

Decks: ${deckNames.join(', ')}`);
  process.exit(1);
}

function watch(): void {
  const seed = Number(arg('seed', String(Math.floor(Math.random() * 1_000_000))));
  const d1 = pickDeck(arg('deck1'), seed);
  const d2 = pickDeck(arg('deck2'), seed + 1);
  console.log(`Seed ${seed}: ${d1.key} (Player 1) vs ${d2.key} (Player 2)\n`);
  const result = simulateGame(catalog, d1.deck, d2.deck, { seed });
  for (const e of result.events) console.log(describeEvent(catalog, e));
  console.log(`\n${result.steps} actions, ${result.state.turn} turns.`);
  console.log(`Replay this game with --seed ${seed} --deck1 ${d1.key} --deck2 ${d2.key}`);
}

async function play(): Promise<void> {
  const seed = Number(arg('seed', String(Math.floor(Math.random() * 1_000_000))));
  const mine = pickDeck(arg('deck'), seed);
  const theirs = pickDeck(arg('vs'), seed + 1);
  const human: PlayerIndex = 0;
  console.log(`Seed ${seed}. You: ${mine.key}. Opponent (bot): ${theirs.key}.`);

  const created = createGame(catalog, mine.deck, theirs.deck, seed);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  let { state, events } = created.value as Transition;
  const botRng = new Rng(seed + 1);

  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const ask = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const next = await lines.next();
    return next.done ? null : next.value.trim();
  };
  const show = (list: typeof events): void => {
    for (const e of list) console.log(`  ${describeEvent(catalog, e)}`);
  };
  show(events);

  const apply = (player: PlayerIndex, action: Action): void => {
    const r = applyAction(catalog, state, player, action);
    if (!r.ok) throw new Error(`Rejected: ${r.error.code}`);
    state = r.value.state;
    events = r.value.events;
    show(events);
  };

  while (state.phase !== 'finished') {
    const order: PlayerIndex[] =
      state.phase === 'setup' ? [0, 1] : [...state.pendingDecisions.map((d) => d.player), state.currentPlayer];
    const actor = order.find((p) => legalActions(catalog, state, p).length > 0);
    if (actor === undefined) throw new Error('Game is stuck');

    if (actor !== human) {
      apply(actor, chooseAction(legalActions(catalog, state, actor), botRng, 'aggressive'));
      continue;
    }

    console.log(`\n${renderBoard(catalog, state, human)}\n`);
    // Identical-looking options (e.g. three copies of the same card) are listed once.
    const seen = new Set<string>();
    const legal = legalActions(catalog, state, human).filter((a) => {
      const text = describeAction(catalog, state, human, a);
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    });
    legal.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. ${describeAction(catalog, state, human, a)}`));
    const answer = await ask('Choose an action number (q to quit): ');
    if (answer === null || answer === 'q') {
      console.log('\nBye!');
      return;
    }
    const choice = legal[Number(answer) - 1];
    if (!choice) {
      console.log('Not a valid choice.');
      continue;
    }
    apply(human, choice);
  }
  console.log(`\n${renderBoard(catalog, state, human)}`);
  console.log(state.result?.winner === human ? '\nYou win!' : state.result?.winner === null ? '\nSudden death!' : `\n${playerName(human === 0 ? 1 : 0)} wins.`);
}

const command = process.argv[2];
if (command === 'watch') watch();
else if (command === 'play') await play();
else usage();

