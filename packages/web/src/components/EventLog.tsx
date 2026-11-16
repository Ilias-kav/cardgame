import type { CardCatalog, PlayerIndex } from '@cardgame/engine';
import { useEffect, useRef } from 'react';
import { formatEvent } from '../game/format.js';
import type { LogEntry } from '../game/gameStore.js';

/** What has happened so far, newest at the bottom (scrolls by itself). */
export function EventLog({
  log,
  catalog,
  mySeat,
  names,
}: {
  log: LogEntry[];
  catalog: CardCatalog;
  mySeat: PlayerIndex;
  names: [string, string];
}) {
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [log.length]);

  const lines = log
    .map((entry) => ({ id: entry.id, line: formatEvent(entry.event, { catalog, mySeat, names }) }))
    .filter((l) => l.line !== null);

  return (
    <div className="log" aria-label="Game log" data-testid="log">
      {lines.length === 0 && <p className="muted small">Nothing has happened yet.</p>}
      {lines.map(({ id, line }) => (
        <p key={id} className={`log-line log-${line!.tone}`}>
          {line!.text}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}
