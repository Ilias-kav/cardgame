/** What a player may ask the engine to do. The server validates and applies these. */
export type Action =
  // --- setup ---
  | { type: 'SETUP_DRAW_EXTRA'; count: number }
  | { type: 'SETUP_PLACE'; active: string; bench: string[] }
  // --- main phase (not implemented yet: phase 2) ---
  | { type: 'PLAY_BASIC'; iid: string }
  | { type: 'ATTACH_POWER'; iid: string; target: CreatureRef }
  | { type: 'EVOLVE'; iid: string; target: CreatureRef }
  | { type: 'PLAY_ITEM'; iid: string; params?: Record<string, unknown> }
  | { type: 'USE_ABILITY'; target: CreatureRef; params?: Record<string, unknown> }
  | { type: 'RETREAT'; benchIndex: number; discard: string[] }
  | { type: 'ATTACK'; attackIndex: number }
  | { type: 'END_TURN' }
  // --- pending decisions (phase 3) ---
  | { type: 'PROMOTE'; benchIndex: number };

/** 'active' or a bench position. */
export type CreatureRef = { zone: 'active' } | { zone: 'bench'; index: number };
