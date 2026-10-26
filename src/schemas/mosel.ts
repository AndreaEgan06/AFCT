// src/schemas/mosel.ts
//
// The MOSEL description of a finite automaton problem's target language, as JSON: an alphabet
// and a condition, standing for the strings over the alphabet that satisfy the condition. That
// is a whole answer key, so a problem can have a description instead of an answer file. The
// evaluator parses the same shape (afctevaluator.mosel.grading.MoselSpecParser in
// AFCT-Evaluator) and maps each leaf onto one of its fact-tracking systems, so the two must
// change together. This is only the shape check: whether a description actually describes
// the same language as an answer file can only be answered by the evaluator, which reports
// it as `analysis.specMatchesAnswerKey`.
import { z } from 'zod';

/**
 * Bounds that keep one description from becoming a denial of service. The evaluator tracks
 * the product of every leaf's facts, so these are about the size of that product, not about
 * what a sensible problem needs (which is far less).
 */
export const MOSEL_LIMITS = {
  maxWordLength: 50,
  // The words a oneOf lists. Its facts are the prefixes of the words, so about
  // maxWords * maxWordLength of them at most.
  maxWords: 50,
  maxCount: 100,
  maxModulus: 100,
  maxLeaves: 8,
  // Also how far a@(last - k) looks back, which costs about 2^k facts.
  maxOffset: 10,
  // valueMod reads digits 0-9 and then a-z, so base 36 uses every one of them.
  maxBase: 36,
  // Every symbol multiplies the transitions the evaluator builds; 36 covers 0-9 and a-z.
  maxAlphabet: 36,
} as const;

const word = z
  .string()
  .min(1, 'The word must not be empty.')
  .max(MOSEL_LIMITS.maxWordLength, `Words are limited to ${MOSEL_LIMITS.maxWordLength} symbols.`);
// A word in a oneOf list, which may be the empty word.
const listedWord = z
  .string()
  .max(MOSEL_LIMITS.maxWordLength, `Words are limited to ${MOSEL_LIMITS.maxWordLength} symbols.`);
const symbol = z.string().length(1, 'A symbol is a single character.');
const alphabetSymbol = symbol.refine((a) => a.trim() !== '', 'A symbol cannot be whitespace.');
const count = z.number().int().min(0).max(MOSEL_LIMITS.maxCount);
const modulus = z.number().int().min(1).max(MOSEL_LIMITS.maxModulus);
const remainder = z.number().int().min(0);
const base = z.number().int().min(2).max(MOSEL_LIMITS.maxBase);
const offset = z.number().int().min(-MOSEL_LIMITS.maxOffset).max(MOSEL_LIMITS.maxOffset);
const lookahead = z.number().int().min(0).max(MOSEL_LIMITS.maxOffset);

export const MOSEL_COMPARISONS = ['<', '<=', '=', '!=', '>=', '>'] as const;
export type MoselComparison = (typeof MOSEL_COMPARISONS)[number];
const cmp = z.enum(MOSEL_COMPARISONS);

export const MOSEL_RANGES = ['psLt', 'psLe', 'psGt', 'psGe'] as const;
export type MoselRange = (typeof MOSEL_RANGES)[number];
const range = z.enum(MOSEL_RANGES);

/** A position: fst or last, or the start of the first or last occurrence of w, moved by offset. */
const positionSchema = z.discriminatedUnion('pos', [
  z.object({ pos: z.literal('fst'), offset }).strict(),
  z.object({ pos: z.literal('last'), offset }).strict(),
  z.object({ pos: z.literal('fstOc'), w: word, offset }).strict(),
  z.object({ pos: z.literal('lastOc'), w: word, offset }).strict(),
]);

export type MoselPosition = z.infer<typeof positionSchema>;

const leafSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('true') }).strict(),
  z.object({ kind: z.literal('false') }).strict(),
  z.object({ kind: z.literal('isEmpty') }).strict(),
  z.object({ kind: z.literal('begWt'), w: word }).strict(),
  z.object({ kind: z.literal('endWt'), w: word }).strict(),
  z
    .object({
      kind: z.literal('oneOf'),
      words: z
        .array(listedWord)
        .min(1, 'oneOf needs at least one word.')
        .max(MOSEL_LIMITS.maxWords, `oneOf lists at most ${MOSEL_LIMITS.maxWords} words.`),
    })
    .strict(),
  z.object({ kind: z.literal('count'), w: word, cmp, n: count }).strict(),
  z.object({ kind: z.literal('countMod'), w: word, m: modulus, cmp, r: remainder }).strict(),
  z.object({ kind: z.literal('length'), cmp, n: count }).strict(),
  z.object({ kind: z.literal('lengthMod'), m: modulus, cmp, r: remainder }).strict(),
  z.object({ kind: z.literal('sumMod'), m: modulus, cmp, r: remainder }).strict(),
  z.object({ kind: z.literal('valueMod'), base, m: modulus, cmp, r: remainder }).strict(),
  z.object({ kind: z.literal('symbolFromStart'), a: symbol, k: lookahead }).strict(),
  z.object({ kind: z.literal('symbolFromEnd'), a: symbol, k: lookahead }).strict(),
  z.object({ kind: z.literal('periodicSymbol'), a: symbol, m: modulus, r: remainder }).strict(),
  z
    .object({
      kind: z.literal('positionCompare'),
      left: positionSchema,
      cmp,
      right: positionSchema,
    })
    .strict(),
  z.object({ kind: z.literal('symbolOnRange'), a: symbol, range, pos: positionSchema }).strict(),
  z.object({ kind: z.literal('rangeCount'), range, pos: positionSchema, cmp, n: count }).strict(),
  z
    .object({
      kind: z.literal('rangeCountMod'),
      range,
      pos: positionSchema,
      m: modulus,
      cmp,
      r: remainder,
    })
    .strict(),
]);

export type MoselLeaf = z.infer<typeof leafSchema>;
export type MoselLeafKind = MoselLeaf['kind'];
export type MoselCondition =
  | MoselLeaf
  | { op: 'and' | 'or'; args: MoselCondition[] }
  | { op: 'not'; args: [MoselCondition] }
  | { op: 'implies' | 'iff'; args: [MoselCondition, MoselCondition] };

const conditionSchema: z.ZodType<MoselCondition> = z.lazy(() =>
  z.union([
    leafSchema,
    z
      .object({
        op: z.enum(['and', 'or']),
        args: z.array(conditionSchema).min(2, 'An and/or needs at least two conditions.'),
      })
      .strict(),
    // Unary, but written with the same `args` array as and/or so every operator node has one shape.
    z
      .object({
        op: z.literal('not'),
        args: z.tuple([conditionSchema], { message: 'A not takes exactly one condition.' }),
      })
      .strict(),
    z
      .object({
        op: z.enum(['implies', 'iff']),
        args: z.tuple([conditionSchema, conditionSchema], {
          message: 'An implies/iff takes exactly two conditions.',
        }),
      })
      .strict(),
  ]),
);

export function moselLeaves(condition: MoselCondition): MoselLeaf[] {
  return 'op' in condition ? condition.args.flatMap(moselLeaves) : [condition];
}

function positionWords(position: MoselPosition): string[] {
  return 'w' in position ? [position.w] : [];
}

/** Every word and symbol a leaf names, which must all be written over the alphabet. */
function leafText(leaf: MoselLeaf): string[] {
  switch (leaf.kind) {
    case 'begWt':
    case 'endWt':
    case 'count':
    case 'countMod':
      return [leaf.w];
    case 'oneOf':
      return leaf.words;
    case 'symbolFromStart':
    case 'symbolFromEnd':
    case 'periodicSymbol':
      return [leaf.a];
    case 'positionCompare':
      return [...positionWords(leaf.left), ...positionWords(leaf.right)];
    case 'symbolOnRange':
      return [leaf.a, ...positionWords(leaf.pos)];
    case 'rangeCount':
    case 'rangeCountMod':
      return positionWords(leaf.pos);
    default:
      return [];
  }
}

export const MoselSpecSchema = z
  .object({
    alphabet: z
      .array(alphabetSymbol)
      .min(1, 'The alphabet needs at least one symbol.')
      .max(
        MOSEL_LIMITS.maxAlphabet,
        `The alphabet is limited to ${MOSEL_LIMITS.maxAlphabet} symbols.`,
      ),
    condition: conditionSchema,
  })
  .strict()
  .superRefine((spec, ctx) => {
    const alphabet = new Set(spec.alphabet);
    if (alphabet.size !== spec.alphabet.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alphabet'],
        message: 'The alphabet lists a symbol twice.',
      });
    }
    const all = moselLeaves(spec.condition);
    if (all.length > MOSEL_LIMITS.maxLeaves) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['condition'],
        message: `A description may combine at most ${MOSEL_LIMITS.maxLeaves} conditions.`,
      });
    }
    for (const leaf of all) {
      // A symbol outside the alphabet never occurs, so naming one is almost certainly a typo.
      const stray = leafText(leaf)
        .flatMap((text) => [...text])
        .find((a) => !alphabet.has(a));
      if (stray !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['condition'],
          message: `The condition uses '${stray}', which is not in the alphabet.`,
        });
      }
      if (leaf.kind === 'oneOf') {
        const twice = leaf.words.find((w, i) => leaf.words.indexOf(w) !== i);
        if (twice !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['condition'],
            message: `oneOf lists '${twice}' twice.`,
          });
        }
      }
      if ('m' in leaf && leaf.r >= leaf.m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['condition'],
          message: `In ${leaf.kind}, the remainder r must be smaller than the modulus m.`,
        });
      }
    }
  });

export type MoselSpec = z.infer<typeof MoselSpecSchema>;

/**
 * The description as it arrives in multipart form data (the problem routes carry the answer
 * file), where it is a JSON string. Absent means "leave it as it is"; a blank value means "no
 * description", which is how an edit removes one. Anything that does not parse is passed
 * through so the schema rejects it with a real message.
 */
export const moselSpecFormField = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}, MoselSpecSchema.nullable().optional());
