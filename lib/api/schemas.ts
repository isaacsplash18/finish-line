/**
 * zod request schemas for every `/api/v1/*` endpoint.
 *
 * Shape only. Content rules (non-empty next action, kill reason, price ≥ 0,
 * terminal stages are final…) are enforced by `lib/data/*`, whose messages
 * come back verbatim as `error` in the response — the API deliberately does
 * not duplicate them, so it can never drift from the UI's economy.
 *
 * Objects are strict: an unknown key (a typo like `nextaction`, or a field
 * the API refuses to expose such as a reward's `status`) is a 400, not a
 * silent no-op.
 */

import { z } from 'zod';

import { dateKey, queryBoolean, queryInt, uuid } from './validation';

const text = z.string({ message: 'Expected a string.' });
const nullableText = text.nullable();

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export const listProjectsQuery = z.object({
  includeTerminal: queryBoolean.optional(),
  stuck: queryBoolean.optional(),
});

/** Create — any non-terminal stage; Building/Commercialising is priced, never blocked. */
export const createProjectBody = z.strictObject({
  name: text,
  next_action: text,
  resolution: nullableText.optional(),
  stage: z
    .enum(['idea', 'building', 'shipped', 'commercialising'], {
      message: 'Must be idea, building, shipped or commercialising.',
    })
    .optional(),
  stage_target_date: dateKey.nullable().optional(),
});

export const updateProjectBody = z.strictObject({
  name: text.optional(),
  resolution: nullableText.optional(),
  next_action: text.optional(),
  stage_target_date: dateKey.nullable().optional(),
});

/** Killed / Abandoned have their own endpoints so a reason is always captured. */
export const MOVABLE_STAGES = ['idea', 'building', 'shipped', 'commercialising', 'done'] as const;

export const moveProjectBody = z.strictObject({
  toStage: z.enum(MOVABLE_STAGES, {
    message:
      'Must be idea, building, shipped, commercialising or done. Use POST /projects/:id/kill or /abandon to end a project.',
  }),
  note: text.optional(),
  stageTargetDate: dateKey.nullable().optional(),
});

/** `reason` is required — `killProject` rejects a missing/blank one with the app's own copy. */
export const killProjectBody = z.strictObject({
  reason: text.optional().default(''),
});

export const abandonProjectBody = z.strictObject({
  reason: text.optional(),
});

/** Mirrors `ImportProjectInput` (lib/types.ts). */
export const importProjectBody = z.strictObject({
  name: text,
  nextAction: text,
  stage: z.enum(['building', 'shipped', 'commercialising'], {
    message: 'Must be building, shipped or commercialising. Ideas are free — POST /projects instead.',
  }),
  startedAt: dateKey,
  resolution: nullableText.optional(),
  stageTargetDate: dateKey.nullable().optional(),
});

/* ------------------------------------------------------------------ */
/* Routines                                                            */
/* ------------------------------------------------------------------ */

export const listRoutinesQuery = z.object({
  days: queryInt(1, 366).optional(),
  includeInactive: queryBoolean.optional(),
});

export const toggleRoutineBody = z.strictObject({
  date: dateKey.optional(),
});

export const checkRoutineBody = z.strictObject({
  date: dateKey.optional(),
  count: z
    .number({ message: 'Required: a whole number ≥ 0.' })
    .int({ message: 'Must be a whole number.' })
    .min(0, { message: 'Must be 0 or more.' }),
});

export const incrementRoutineBody = z.strictObject({
  date: dateKey.optional(),
  by: z.number().int({ message: 'Must be a whole number.' }).optional(),
});

export const sabbathBody = z.strictObject({
  date: dateKey,
});

/* ------------------------------------------------------------------ */
/* Rewards — no `status`: claim via /claim, forfeits happen via abandon */
/* ------------------------------------------------------------------ */

export const createRewardBody = z.strictObject({
  name: text,
  price: z.number({ message: 'Must be a number.' }),
  project_id: uuid.nullable().optional(),
});

export const updateRewardBody = z.strictObject({
  name: text.optional(),
  price: z.number({ message: 'Must be a number.' }).optional(),
  project_id: uuid.nullable().optional(),
});

/* ------------------------------------------------------------------ */
/* Key dates                                                           */
/* ------------------------------------------------------------------ */

export const listKeyDatesQuery = z.object({
  limit: queryInt(1, 500).optional(),
  upcomingOnly: queryBoolean.optional(),
});

export const createKeyDateBody = z.strictObject({
  name: text,
  date: dateKey,
  project_id: uuid.nullable().optional(),
});

export const updateKeyDateBody = z.strictObject({
  name: text.optional(),
  date: dateKey.optional(),
  project_id: uuid.nullable().optional(),
});

/* ------------------------------------------------------------------ */
/* Scores                                                              */
/* ------------------------------------------------------------------ */

export const listScoresQuery = z.object({
  days: queryInt(1, 366).optional(),
});
