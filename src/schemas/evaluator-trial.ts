import { z } from 'zod';
import { formBooleanOptional, formIntOptional } from './fields';
import { ProblemTypeEnum } from './problem';
import { moselSpecFormField } from './mosel';

/**
 * A staff evaluator trial as it arrives from the page (multipart, so every scalar is a
 * string). The two files and the size check stay in the route: the cap is the admin's
 * configured upload limit, which a schema built at module load cannot see.
 */
export const EvaluatorTrialCreateApiSchema = z.object({
  type: ProblemTypeEnum,
  // The same range a real FA/PDA problem allows: 1-1000 states, or -1 for unbounded.
  // Left empty it is unbounded too, which is what the evaluator gets for a problem
  // saved with "unlimited" ticked.
  maxStates: formIntOptional().refine(
    (n) => n === undefined || n === -1 || (n >= 1 && n <= 1000),
    'Max states must be -1 (unlimited) or between 1 and 1000.',
  ),
  isDeterministic: formBooleanOptional,
  // FA only, optional: a MOSEL description to analyse the submitted file against.
  moselSpec: moselSpecFormField,
  // RUBRIC: optional; one of the caller's rubrics (or one in use in a course they staff).
  rubricId: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().trim().min(1).optional(),
  ),
});

export type EvaluatorTrialCreateApiInput = z.infer<typeof EvaluatorTrialCreateApiSchema>;
