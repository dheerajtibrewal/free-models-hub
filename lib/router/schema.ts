import { z } from 'zod';

/**
 * Request validation for /api/run.
 *
 * Size ceilings are enforced here as a second line of defence: the client
 * normalizes media before upload (1024px images, 16kHz mono audio capped at
 * 120s), but a hand-rolled request must not be able to push a 4MB payload into
 * a provider call and waste quota. Vercel's own 4.5MB body cap sits above this.
 */

const MAX_TEXT_CHARS = 20_000;
/** Base64 inflates by ~4/3, so 2.8MB of base64 is ~2.1MB of bytes. */
const MAX_BASE64_CHARS = 2_800_000;

export const textPayloadSchema = z.object({
  modality: z.literal('text'),
  text: z.string().min(1, 'Enter some text first.').max(MAX_TEXT_CHARS),
});

export const imagePayloadSchema = z.object({
  modality: z.literal('image'),
  base64: z.string().min(1).max(MAX_BASE64_CHARS, 'Image is too large after downscaling.'),
  mimeType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/, 'Unsupported image type.'),
});

export const audioPayloadSchema = z.object({
  modality: z.literal('audio'),
  base64: z.string().min(1).max(MAX_BASE64_CHARS, 'Audio is too large. Keep it under 2 minutes.'),
  mimeType: z.string().regex(/^audio\//, 'Unsupported audio type.'),
  durationSec: z.number().positive().max(120, 'Audio must be 2 minutes or shorter.').optional(),
});

export const inputPayloadSchema = z.discriminatedUnion('modality', [
  textPayloadSchema,
  imagePayloadSchema,
  audioPayloadSchema,
]);

export const runRequestSchema = z.object({
  /** Recipe slug, e.g. 'audio-to-image'. */
  task: z.string().min(1).max(64),
  payload: inputPayloadSchema,
  instruction: z.string().max(MAX_TEXT_CHARS).optional(),
});

export type RunRequest = z.infer<typeof runRequestSchema>;
export type InputPayload = z.infer<typeof inputPayloadSchema>;
