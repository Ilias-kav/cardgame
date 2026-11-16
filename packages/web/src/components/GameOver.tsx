import type { PlayerIndex } from '@cardgame/engine';
import { describeOutcome } from '../game/format.js';
import type { GameOver as GameOverState } from '../game/gameStore.js';

export function GameOver({
  over,
  mySeat,
  names,
  onLeave,
}: {
  over: GameOverState;
  mySeat: PlayerIndex;
  names: [string, string];
  onLeave(): void;
}) {
  const outcome = over.outcome;
  const rematch = over.rematchGameId !== null;
  let title = 'Game over';
  let text = 'The game ended while you were away.';
  if (outcome) {
    text = describeOutcome(outcome, mySeat, names);
    if (rematch) title = 'Sudden death!';
    else if (outcome.winner === null) title = 'No winner';
    else title = outcome.winner === mySeat ? 'You won! 🎉' : 'You lost';
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog" data-testid="game-over">
        <h2>{title}</h2>
        <p>{text}</p>
        {rematch ? (
          <p className="muted">A new game with 1 prize card each is starting…</p>
        ) : (
          <button type="button" className="primary" onClick={onLeave} data-testid="leave-game">
            Back to the lobby
          </button>
        )}
      </div>
    </div>
  );
}
