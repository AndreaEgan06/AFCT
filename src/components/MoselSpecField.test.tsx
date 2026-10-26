import { describe, expect, it } from 'vitest';

import {
  EMPTY_MOSEL_DRAFT,
  moselDraftJson,
  moselSpecDraft,
  moselSpecError,
  moselSpecSummary,
} from '@/components/MoselSpecField';

describe('the MOSEL draft', () => {
  it('is no description when blank', () => {
    expect(moselSpecError(EMPTY_MOSEL_DRAFT)).toBeNull();
    expect(moselDraftJson({ alphabet: ' ', formula: '\n' })).toBeNull();
  });

  it('translates to the JSON the API takes', () => {
    const draft = { alphabet: 'a, b', formula: 'begWt\'a\'AND|indOf"ab"|%2=1' };
    expect(moselSpecError(draft)).toBeNull();
    expect(JSON.parse(moselDraftJson(draft)!)).toEqual({
      alphabet: ['a', 'b'],
      condition: {
        op: 'and',
        args: [
          { kind: 'begWt', w: 'a' },
          { kind: 'countMod', w: 'ab', m: 2, cmp: '=', r: 1 },
        ],
      },
    });
    expect(JSON.parse(moselDraftJson({ alphabet: '0 1 2', formula: 'sum(s) % 3 = 0' })!)).toEqual({
      alphabet: ['0', '1', '2'],
      condition: { kind: 'sumMod', m: 3, cmp: '=', r: 0 },
    });
  });

  it('needs both the alphabet and the condition', () => {
    expect(moselSpecError({ alphabet: '', formula: "endWt 'a'" })).toMatch(/Give the alphabet/);
    expect(moselSpecError({ alphabet: 'a, b', formula: '' })).toMatch(/Write the condition/);
  });

  it('only lets the condition name symbols in the alphabet', () => {
    expect(moselSpecError({ alphabet: 'a, b', formula: "endWt 'ac'" })).toMatch(
      /uses 'c', which is not in the alphabet/,
    );
    expect(moselSpecError({ alphabet: 'a, b', formula: "fstOc 'x' < fstOc 'a'" })).toMatch(/'x'/);
    expect(moselSpecError({ alphabet: 'a, b, c', formula: "endWt 'ac' AND c@(last - 1)" })).toBe(
      null,
    );
  });

  it('says why the alphabet is not one', () => {
    expect(moselSpecError({ alphabet: 'ab', formula: "endWt 'a'" })).toMatch(
      /^Alphabet: 'ab' is not one symbol/,
    );
    expect(moselSpecError({ alphabet: 'a, a', formula: "endWt 'a'" })).toMatch(/twice/);
  });

  it('says why it is not a description', () => {
    expect(moselSpecError({ alphabet: 'a', formula: "begWt 'a' OR" })).toMatch(
      /^Formula, at character 13: /,
    );
    const many = Array.from({ length: 9 }, () => "begWt 'a'").join(' OR ');
    expect(moselSpecError({ alphabet: 'a', formula: many })).toMatch(/at most 8/);
  });

  it('reads a stored description back into the same JSON', () => {
    const stored = {
      condition: {
        args: [
          { op: 'not', args: [{ w: 'b', kind: 'endWt' }] },
          { op: 'implies', args: [{ kind: 'symbolFromEnd', a: 'b', k: 1 }, { kind: 'isEmpty' }] },
          {
            op: 'or',
            args: [
              { kind: 'lengthMod', m: 2, cmp: '=', r: 0 },
              { kind: 'begWt', w: 'a' },
            ],
          },
        ],
        op: 'and',
      },
      alphabet: ['a', 'b'],
    };
    const draft = moselSpecDraft(stored);
    expect(draft).toEqual({
      alphabet: 'a, b',
      formula: "NOT endWt 'b' AND (b@(last - 1) IMPLIES isEmpty) AND (|s| % 2 = 0 OR begWt 'a')",
    });
    expect(JSON.parse(moselDraftJson(draft)!)).toEqual(stored);
    expect(moselSpecDraft(null)).toEqual(EMPTY_MOSEL_DRAFT);
  });

  it('summarises a stored description on one line', () => {
    expect(
      moselSpecSummary({
        alphabet: ['0', '1'],
        condition: { kind: 'count', w: '10', cmp: '=', n: 0 },
      }),
    ).toBe("{0, 1}: |indOf '10'| = 0");
    expect(moselSpecSummary(null)).toBeNull();
  });
});
