import { isBasicCreature, type CardCatalog } from '@cardgame/engine';
import type { PlayerView } from '@cardgame/protocol';
import { useState } from 'react';
import { CardButton } from './parts.js';

/** The start of a game: optional extra cards after a mulligan, then choose starting creatures. */
export function SetupPanel({
  view,
  catalog,
  onDraw,
  onPlace,
}: {
  view: PlayerView;
  catalog: CardCatalog;
  onDraw(count: number): void;
  onPlace(active: string, bench: string[]): void;
}) {
  const setup = view.setup;
  const [active, setActive] = useState<string | null>(null);
  const [bench, setBench] = useState<string[]>([]);
  if (!setup) return null;

  const mulliganNote = (
    <>
      {setup.you.mulligans > 0 && (
        <p className="muted">You had no basic creature and had to mulligan {setup.you.mulligans}×.</p>
      )}
      {setup.opponent.mulligans > 0 && (
        <p className="muted">Your opponent had to mulligan {setup.opponent.mulligans}×.</p>
      )}
    </>
  );

  if (setup.you.placed) {
    return (
      <div className="panel" data-testid="setup-waiting">
        <h3>Ready</h3>
        <p>Waiting for your opponent to place their starting creatures…</p>
        {mulliganNote}
      </div>
    );
  }

  if (!setup.you.extraDrawResolved) {
    const max = setup.you.extraDrawAvailable;
    return (
      <div className="panel" data-testid="setup-draw">
        <h3>Extra cards</h3>
        {mulliganNote}
        <p>
          Your opponent had to mulligan, so you may draw up to <strong>{max}</strong> extra card{max === 1 ? '' : 's'}.
        </p>
        <div className="row">
          {Array.from({ length: max + 1 }, (_, n) => (
            <button key={n} type="button" onClick={() => onDraw(n)} data-testid={`setup-draw-${n}`}>
              Draw {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const basics = view.you.hand.filter((c) => {
    const def = catalog[c.cardId];
    return def !== undefined && isBasicCreature(def);
  });
  const toggleBench = (iid: string) =>
    setBench((list) => (list.includes(iid) ? list.filter((x) => x !== iid) : list.length < 5 ? [...list, iid] : list));

  return (
    <div className="panel" data-testid="setup-place">
      <h3>Choose your starting creatures</h3>
      {mulliganNote}
      <p className="muted">Pick one active creature. Any other basic creatures can start on your bench (up to 5).</p>
      <ul className="setup-list">
        {basics.map((c) => {
          const def = catalog[c.cardId]!;
          return (
            <li key={c.iid} className={active === c.iid ? 'chosen' : ''}>
              <CardButton card={def} selected={active === c.iid || bench.includes(c.iid)} testId={`setup-card-${c.iid}`} />
              <label>
                <input
                  type="radio"
                  name="active"
                  checked={active === c.iid}
                  onChange={() => {
                    setActive(c.iid);
                    setBench((list) => list.filter((x) => x !== c.iid));
                  }}
                />{' '}
                Active
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bench.includes(c.iid)}
                  disabled={active === c.iid}
                  onChange={() => toggleBench(c.iid)}
                />{' '}
                Bench
              </label>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="primary"
        disabled={active === null}
        onClick={() => active && onPlace(active, bench)}
        data-testid="setup-confirm"
      >
        Confirm
      </button>
    </div>
  );
}
