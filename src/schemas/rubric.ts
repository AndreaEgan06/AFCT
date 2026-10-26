// src/schemas/rubric.ts
//
// RUBRIC: the rubric definition shape and the rubric API bodies (see RUBRIC_LOCATIONS.md).
//
// What a rubric does is not decided yet. Until it is, the only definition that exists is
// the binary one, which grades exactly like having no rubric: full points when correct,
// nothing otherwise. The `version` and `kind` fields are there so the real shape can be
// added beside it. The evaluator parses the same shape
// (afctevaluator.mosel.grading.RubricParser in AFCT-Evaluator).
import { z } from 'zod';

/** RUBRIC: binary-only placeholder; add the real kinds here. */
export const RubricDefinitionSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('binary'),
  })
  .strict();

export type RubricDefinition = z.infer<typeof RubricDefinitionSchema>;

/** RUBRIC: the one definition a new rubric can have for now. */
export const BINARY_RUBRIC_DEFINITION: RubricDefinition = { version: 1, kind: 'binary' };

const name = z.string().trim().min(1, 'Name is required.').max(100, 'Name is too long.');
const description = z.string().trim().max(2000, 'Description is too long.');

/**
 * Creating a rubric. Name and description only: there is nothing else to choose yet, so the
 * server writes {@link BINARY_RUBRIC_DEFINITION} itself rather than accepting one.
 *
 * RUBRIC: accept a definition here once there is more than one kind.
 */
export const RubricCreateApiSchema = z
  .object({
    name,
    description: description.nullish(),
  })
  .strict();

/** Renaming or re-describing a rubric. RUBRIC: and later, editing its definition. */
export const RubricUpdateApiSchema = z
  .object({
    name: name.optional(),
    description: description.nullish(),
  })
  .strict();

export type RubricCreateApiInput = z.infer<typeof RubricCreateApiSchema>;
export type RubricUpdateApiInput = z.infer<typeof RubricUpdateApiSchema>;
