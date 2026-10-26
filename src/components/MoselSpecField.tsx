'use client';

import { FieldLabelRow, FieldMessage, composeDescribedBy } from '@/components/ui/field';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  formatMoselAlphabet,
  formatMoselFormula,
  parseMoselAlphabet,
  parseMoselFormula,
} from '@/lib/mosel-formula';
import { MoselSpecSchema, type MoselSpec } from '@/schemas/mosel';
import { ChevronDown } from 'lucide-react';

/** An example to start from, shown as the placeholders. */
export const MOSEL_ALPHABET_EXAMPLE = 'a, b';
export const MOSEL_FORMULA_EXAMPLE = "begWt 'ab' AND |indOf 'b'| >= 2";

/**
 * The description as it is being edited: the alphabet and the formula, as typed. The form
 * sends the JSON they translate to (see moselDraftJson), which is what the API and the
 * evaluator read.
 */
export type MoselSpecDraft = { alphabet: string; formula: string };

export const EMPTY_MOSEL_DRAFT: MoselSpecDraft = { alphabet: '', formula: '' };

/** Whether nothing has been typed, which means "no description" rather than a bad one. */
export function isBlankMoselDraft(draft: MoselSpecDraft): boolean {
  return draft.alphabet.trim() === '' && draft.formula.trim() === '';
}

/**
 * The draft read into a description: `spec` null with no error when it is blank (which means
 * "no description"), otherwise either the description or the reason there is none. It ends
 * in the same schema the server applies, so a draft this accepts is one the save will accept.
 */
function readDraft(draft: MoselSpecDraft): { spec: MoselSpec | null; error: string | null } {
  if (isBlankMoselDraft(draft)) return { spec: null, error: null };
  if (draft.alphabet.trim() === '') {
    return { spec: null, error: 'Give the alphabet: the symbols the strings are made of.' };
  }
  if (draft.formula.trim() === '') {
    return { spec: null, error: 'Write the condition, or clear the alphabet as well.' };
  }

  const alphabet = parseMoselAlphabet(draft.alphabet);
  if (!alphabet.ok) return { spec: null, error: `Alphabet: ${alphabet.error}` };

  const parsed = parseMoselFormula(draft.formula);
  if (!parsed.ok) {
    return { spec: null, error: `Formula, at character ${parsed.index + 1}: ${parsed.error}` };
  }

  const result = MoselSpecSchema.safeParse({
    alphabet: alphabet.symbols,
    condition: parsed.condition,
  });
  if (result.success) return { spec: result.data, error: null };
  return {
    spec: null,
    error: result.error.issues[0]?.message ?? 'This is not a valid description.',
  };
}

/** Why the draft is not a usable description, or null when it is (or is blank). */
export function moselSpecError(draft: MoselSpecDraft): string | null {
  return readDraft(draft).error;
}

/** The JSON the form sends for the draft, or null when it is blank or not valid. */
export function moselDraftJson(draft: MoselSpecDraft): string | null {
  const { spec } = readDraft(draft);
  return spec ? JSON.stringify(spec) : null;
}

/** A stored description as the draft the field edits. */
export function moselSpecDraft(spec: unknown): MoselSpecDraft {
  const result = MoselSpecSchema.safeParse(spec);
  if (!result.success) return EMPTY_MOSEL_DRAFT;
  return {
    alphabet: formatMoselAlphabet(result.data.alphabet),
    formula: formatMoselFormula(result.data.condition),
  };
}

/**
 * A stored description on one line, for staff views that show it where an answer file would
 * be, e.g. `{0, 1}: |indOf '10'| = 0`. Null when there is none (or it is not valid).
 */
export function moselSpecSummary(spec: unknown): string | null {
  const result = MoselSpecSchema.safeParse(spec);
  if (!result.success) return null;
  return `{${formatMoselAlphabet(result.data.alphabet)}}: ${formatMoselFormula(result.data.condition)}`;
}

/**
 * The MOSEL description of a finite automaton problem's language: an alphabet such as `a, b`
 * and a condition such as `begWt 'a' AND |indOf "ab"| % 2 = 1`, standing for the strings over
 * the alphabet that satisfy the condition.
 *
 * That is a complete answer key. Without an answer file, submissions are marked against it,
 * and students see exactly what an answer file for the same language would have shown them.
 * With one, the answer file decides what is correct. Either way the evaluator also checks each
 * state of a submitted automaton against the description and stores that analysis with the
 * attempt for staff, which is what partial credit will be built on.
 */
export function MoselSpecField({
  id,
  value,
  onChange,
  disabled,
  label = 'Language Description (MOSEL, optional)',
}: {
  id: string;
  value: MoselSpecDraft;
  onChange: (value: MoselSpecDraft) => void;
  disabled?: boolean;
  label?: string;
}) {
  const error = moselSpecError(value) ?? undefined;
  const alphabetId = `${id}-alphabet`;
  const descId = `${id}-desc`;
  const errorId = `${id}-error`;
  const describedBy = composeDescribedBy(error ? errorId : undefined, descId);

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <FieldLabelRow htmlFor={alphabetId}>Alphabet</FieldLabelRow>
      <Input
        id={alphabetId}
        name={alphabetId}
        value={value.alphabet}
        onChange={(e) => onChange({ ...value, alphabet: e.target.value })}
        disabled={disabled}
        placeholder={MOSEL_ALPHABET_EXAMPLE}
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs md:text-xs"
        aria-invalid={!!error}
        aria-describedby={describedBy}
      />
      <FieldLabelRow htmlFor={id}>Condition</FieldLabelRow>
      <Textarea
        id={id}
        name={id}
        value={value.formula}
        onChange={(e) => onChange({ ...value, formula: e.target.value })}
        disabled={disabled}
        placeholder={MOSEL_FORMULA_EXAMPLE}
        rows={2}
        spellCheck={false}
        className="font-mono text-xs md:text-xs"
        aria-invalid={!!error}
        aria-describedby={describedBy}
      />
      <FieldMessage
        description={
          <>
            The alphabet is the symbols the strings are made of, separated by commas or spaces (such
            as <code>0, 1</code>); the condition can only name those. Without an answer file,
            submissions are marked against the strings over the alphabet that satisfy the condition.
            With one, the answer file decides, and the description is used to analyse submissions
            for staff.
          </>
        }
        descriptionId={descId}
        error={error}
        errorId={errorId}
        showDescriptionWithError
      />
      <MoselSyntaxReference />
    </fieldset>
  );
}

/** The conditions a formula can use, each with an example and what it means. */
const MOSEL_CONDITIONS: Array<{ examples: string[]; meaning: string }> = [
  { examples: ["begWt 'w'", "endWt 'w'"], meaning: 'Begins or ends with w.' },
  {
    examples: ["oneOf('a', 'ab', '')"],
    meaning: "Is exactly one of the listed words; '' is the empty string.",
  },
  { examples: ["|indOf 'w'| >= k"], meaning: 'The number of occurrences of w.' },
  { examples: ['|s| = k'], meaning: 'The length.' },
  { examples: ["|indOf 'w'| % m = r", '|s| % m = r'], meaning: 'Either of those, modulo m.' },
  { examples: ['sum(s) % m = r'], meaning: 'The digit sum, modulo m; other symbols add nothing.' },
  {
    examples: ['intBase(b) % m = r'],
    meaning: 'The string as a number in base b, modulo m; other symbols are skipped.',
  },
  { examples: ['a@(fst + k)', 'a@(last - k)'], meaning: 'The symbol at a position is a.' },
  { examples: ['a@all'], meaning: 'Every symbol is a.' },
  { examples: ['a@posMod(m, r)'], meaning: 'The symbol at every position j with j % m = r is a.' },
  {
    examples: ["fstOc 'a' < fstOc 'b'"],
    meaning: "Compares positions: fst, last, fstOc 'w' and lastOc 'w', each ± k.",
  },
  {
    examples: ["b@psGt fstOc 'b'", "|psLe fstOc 'b'| % 2 = 1"],
    meaning:
      'The positions before or after one (psLt, psLe, psGt, psGe): every symbol there, or how many there are.',
  },
  { examples: ['isEmpty'], meaning: 'The string is empty.' },
  { examples: ['true', 'false'], meaning: 'Always, or never.' },
];

/** The formula syntax, as a table of conditions and a list of what combines them. Closed at first. */
function MoselSyntaxReference() {
  return (
    <Collapsible className="mt-1">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 group -mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium focus-visible:ring-[3px] focus-visible:outline-none">
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform group-data-[state=closed]:-rotate-90"
          aria-hidden="true"
        />
        Condition syntax
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground flex flex-col gap-2 pt-2 text-xs">
        <table className="w-full border-collapse">
          <caption className="sr-only">MOSEL conditions</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="text-foreground py-1 pr-3 text-left font-medium">
                Condition
              </th>
              <th scope="col" className="text-foreground py-1 text-left font-medium">
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            {MOSEL_CONDITIONS.map(({ examples, meaning }) => (
              <tr key={examples[0]} className="border-b last:border-b-0">
                <td className="py-1 pr-3 align-top">
                  {examples.map((example) => (
                    <code key={example} className="block whitespace-nowrap">
                      {example}
                    </code>
                  ))}
                </td>
                <td className="py-1 align-top">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Compare with <code>=</code>, <code>!=</code>, <code>&lt;</code>, <code>&lt;=</code>,{' '}
            <code>&gt;</code> or <code>&gt;=</code>.
          </li>
          <li>Words go in single or double quotes.</li>
          <li>
            Combine with <code>NOT</code>, <code>AND</code>, <code>OR</code>, <code>IMPLIES</code>{' '}
            and <code>IFF</code> (any case, binding in that order) and parentheses.
          </li>
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
