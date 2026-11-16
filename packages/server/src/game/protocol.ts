import type { Action } from '@cardgame/engine';
import { z } from 'zod';

// ---------- client -> server (untrusted: validated with zod) ----------

const creatureRef = z.union([
  z.object({ zone: z.literal('active') }),
  z.object({ zone: z.literal('bench'), index: z.number().int().min(0).max(4) }),
]);
const iid = z.string().min(1).max(40);
const params = z.record(z.string(), z.unknown()).optional();

/** The engine's `Action` type, as a runtime check for data coming off the network. */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SETUP_DRAW_EXTRA'), count: z.number().int().min(0).max(100) }),
  z.object({
    type: z.literal('SETUP_PLACE'),
    active: iid,
    bench: z.array(iid).max(10),
  }),
  z.object({ type: z.literal('PLAY_BASIC'), iid }),
  z.object({ type: z.literal('ATTACH_POWER'), iid, target: creatureRef }),
  z.object({ type: z.literal('EVOLVE'), iid, target: creatureRef }),
  z.object({ type: z.literal('PLAY_ITEM'), iid, params }),
  z.object({ type: z.literal('USE_ABILITY'), target: creatureRef, params }),
  z.object({
    type: z.literal('RETREAT'),
    benchIndex: z.number().int().min(0).max(4),
    discard: z.array(iid).max(20),
  }),
  z.object({ type: z.literal('ATTACK'), attackIndex: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal('END_TURN') }),
  z.object({ type: z.literal('PROMOTE'), benchIndex: z.number().int().min(0).max(4) }),
]);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('game.sync') }),
  z.object({ type: z.literal('game.forfeit') }),
  z.object({
    type: z.literal('game.action'),
    action: actionSchema,
    requestId: z.string().max(64).optional(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- server -> client ----------
// The message types are shared with the browser client.
export type { ServerMessage } from '@cardgame/protocol';

/** Compile-time check that validated actions are valid engine actions. */
export type ValidatedAction = Extract<ClientMessage, { type: 'game.action' }>['action'];
export const asEngineAction = (a: ValidatedAction): Action => a;
