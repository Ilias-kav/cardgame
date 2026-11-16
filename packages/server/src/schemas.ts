import { z } from 'zod';

export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,20}$/, 'Username must be 3-20 letters, digits or underscores');

export const registerSchema = z.object({
  username: usernameSchema,
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
});

/** Login does not re-check strength; it only guards against absurdly long input. */
export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const deckInputSchema = z.object({
  name: z.string().trim().min(1, 'Deck name is required').max(40, 'Deck name is at most 40 characters'),
  cards: z
    .array(
      z.object({
        cardId: z.string().min(1).max(100),
        count: z.number().int('count must be a whole number').positive('count must be at least 1').max(999),
      }),
    )
    .max(200),
});

export const uuidSchema = z.string().uuid();

export type DeckInput = z.infer<typeof deckInputSchema>;
