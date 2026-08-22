/**
 * Shared input schemas and parsing helpers.
 *
 * Every value that arrives from a client is parsed through one of these before it
 * reaches the database. Failures are converted into `AppError`s carrying a message
 * that is safe and useful to show the person who typed it.
 */

import { z } from "zod";
import { limits } from "./config.ts";
import { errors } from "./errors.ts";

/** Collapses runs of whitespace and trims — display names shouldn't carry layout. */
const displayName = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z.string()
      .min(1, "Please enter a name.")
      .max(limits.nameMaxLength, `Names can be at most ${limits.nameMaxLength} characters.`),
  );

export const schemas = {
  displayName,

  email: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email("Please enter a valid email address.").max(254)),

  password: z
    .string()
    .min(
      limits.passwordMinLength,
      `Passwords must be at least ${limits.passwordMinLength} characters.`,
    )
    .max(1024, "That password is too long."),

  id: z.string().min(1).max(64),

  gmLogin: z.object({
    // Not `schemas.password` — an existing password shouldn't be re-validated
    // against the current policy at sign-in time.
    email: z.string().max(254),
    password: z.string().max(1024),
  }),

  campaignInput: z.object({
    name: displayName,
  }),

  characterInput: z.object({
    campaignId: z.string().min(1).max(64),
    kind: z.enum(["pc", "npc"]),
    name: displayName,
  }),

  sessionStart: z.object({
    campaignId: z.string().min(1).max(64),
  }),

  sessionJoin: z.object({
    code: z.string().min(1).max(64),
    name: displayName,
  }),

  claim: z.object({
    characterId: z.string().min(1).max(64),
  }),

  reorder: z.object({
    order: z.array(z.string().min(1).max(64)).max(200),
  }),

  setTurn: z.object({
    characterId: z.string().min(1).max(64).nullable(),
  }),

  advanceTurn: z.object({
    direction: z.enum(["next", "prev"]),
  }),

  /** GM edit of a player: release a claim, or hand it to another character. */
  playerUpdate: z.object({
    claimedCharacterId: z.string().min(1).max(64).nullable(),
  }),
};

/**
 * Parses a value, converting a schema failure into a 400 whose message is the
 * first problem the schema reported.
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw errors.badRequest(first?.message ?? "That request wasn't valid.", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
  });
}

/** Parses a JSON request body, rejecting malformed JSON with a friendly message. */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw errors.badRequest("We couldn't read that request. Please try again.");
  }
  return parse(schema, body);
}
