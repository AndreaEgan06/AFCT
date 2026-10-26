import { describe, expect, it } from 'vitest';
import { MoselSpecSchema, moselSpecFormField } from './mosel';

const ok = (spec: unknown) => MoselSpecSchema.safeParse(spec).success;
const ALPHABET = ['a', 'b'];

describe('MoselSpecSchema', () => {
  it('accepts every kind of condition, and and/or trees of them', () => {
    expect(
      ok({
        alphabet: ['a', 'b'],
        condition: {
          op: 'and',
          args: [
            { kind: 'begWt', w: 'ab' },
            {
              op: 'or',
              args: [
                { kind: 'count', w: 'b', cmp: '>=', n: 2 },
                { kind: 'countMod', w: 'a', m: 3, cmp: '!=', r: 1 },
              ],
            },
            { kind: 'lengthMod', m: 2, cmp: '=', r: 0 },
          ],
        },
      }),
    ).toBe(true);
    expect(ok({ alphabet: ALPHABET, condition: { kind: 'sumMod', m: 4, cmp: '=', r: 0 } })).toBe(
      true,
    );
    expect(ok({ alphabet: ALPHABET, condition: { kind: 'oneOf', words: ['', 'a', 'ab'] } })).toBe(
      true,
    );
    expect(
      ok({ alphabet: ALPHABET, condition: { kind: 'valueMod', base: 2, m: 3, cmp: '=', r: 0 } }),
    ).toBe(true);
    expect(
      ok({ alphabet: ALPHABET, condition: { kind: 'valueMod', base: 1, m: 3, cmp: '=', r: 0 } }),
    ).toBe(false);
    expect(
      ok({ alphabet: ALPHABET, condition: { kind: 'valueMod', base: 37, m: 3, cmp: '=', r: 0 } }),
    ).toBe(false);
    expect(ok({ alphabet: ALPHABET, condition: { kind: 'valueMod', m: 3, cmp: '=', r: 0 } })).toBe(
      false,
    );
    expect(
      ok({ alphabet: ALPHABET, condition: { kind: 'valueMod', base: 2, m: 3, cmp: '=', r: 3 } }),
    ).toBe(false);
    expect(
      ok({
        alphabet: ['a', 'b'],
        condition: {
          op: 'iff',
          args: [
            {
              op: 'implies',
              args: [
                { kind: 'symbolFromEnd', a: 'a', k: 2 },
                {
                  kind: 'positionCompare',
                  left: { pos: 'fstOc', w: 'a', offset: 0 },
                  cmp: '<',
                  right: { pos: 'last', offset: -1 },
                },
              ],
            },
            {
              op: 'or',
              args: [
                { kind: 'symbolOnRange', a: 'b', range: 'psGt', pos: { pos: 'fst', offset: 0 } },
                {
                  kind: 'rangeCountMod',
                  range: 'psLe',
                  pos: { pos: 'lastOc', w: 'ab', offset: 1 },
                  m: 2,
                  cmp: '=',
                  r: 1,
                },
                { kind: 'periodicSymbol', a: 'a', m: 2, r: 1 },
                { kind: 'isEmpty' },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('accepts a not of one condition, anywhere in the tree', () => {
    expect(
      ok({ alphabet: ALPHABET, condition: { op: 'not', args: [{ kind: 'endWt', w: 'ab' }] } }),
    ).toBe(true);
    expect(
      ok({
        alphabet: ['a', 'b'],
        condition: {
          op: 'and',
          args: [
            { kind: 'begWt', w: 'a' },
            {
              op: 'not',
              args: [
                {
                  op: 'or',
                  args: [
                    { kind: 'endWt', w: 'b' },
                    { kind: 'lengthMod', m: 2, cmp: '=', r: 0 },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['an unknown kind', { alphabet: ALPHABET, condition: { kind: 'contains', w: 'a' } }],
    ['an empty word', { alphabet: ALPHABET, condition: { kind: 'endWt', w: '' } }],
    [
      'a remainder not below the modulus',
      { alphabet: ALPHABET, condition: { kind: 'lengthMod', m: 2, cmp: '=', r: 2 } },
    ],
    [
      'a zero modulus',
      { alphabet: ALPHABET, condition: { kind: 'lengthMod', m: 0, cmp: '=', r: 0 } },
    ],
    [
      'a negative count',
      { alphabet: ALPHABET, condition: { kind: 'count', w: 'a', cmp: '<=', n: -1 } },
    ],
    [
      'a fractional count',
      { alphabet: ALPHABET, condition: { kind: 'count', w: 'a', cmp: '<=', n: 1.5 } },
    ],
    [
      'an unknown comparison',
      { alphabet: ALPHABET, condition: { kind: 'length', cmp: '=>', n: 1 } },
    ],
    ['a missing comparison', { alphabet: ALPHABET, condition: { kind: 'length', n: 1 } }],
    [
      'an offset beyond the limit',
      { alphabet: ALPHABET, condition: { kind: 'symbolFromEnd', a: 'a', k: 11 } },
    ],
    [
      'a word on fst',
      {
        alphabet: ALPHABET,
        condition: {
          kind: 'symbolOnRange',
          a: 'a',
          range: 'psLe',
          pos: { pos: 'fst', w: 'a', offset: 0 },
        },
      },
    ],
    [
      'an fstOc without a word',
      {
        alphabet: ALPHABET,
        condition: {
          kind: 'rangeCount',
          range: 'psLe',
          pos: { pos: 'fstOc', offset: 0 },
          cmp: '=',
          n: 1,
        },
      },
    ],
    [
      'an implies with three arguments',
      {
        alphabet: ALPHABET,
        condition: { op: 'implies', args: [{ kind: 'true' }, { kind: 'true' }, { kind: 'true' }] },
      },
    ],
    [
      'a symbol of two characters',
      { alphabet: ALPHABET, condition: { kind: 'periodicSymbol', a: 'ab', m: 1, r: 0 } },
    ],
    [
      'an and with one argument',
      { alphabet: ALPHABET, condition: { op: 'and', args: [{ kind: 'begWt', w: 'a' }] } },
    ],
    [
      'a not with two arguments',
      {
        alphabet: ALPHABET,
        condition: {
          op: 'not',
          args: [
            { kind: 'begWt', w: 'a' },
            { kind: 'endWt', w: 'a' },
          ],
        },
      },
    ],
    ['a not with no arguments', { alphabet: ALPHABET, condition: { op: 'not', args: [] } }],
    [
      'a not written with a single arg key',
      { alphabet: ALPHABET, condition: { op: 'not', arg: { kind: 'begWt', w: 'a' } } },
    ],
    ['no alphabet', { condition: { kind: 'begWt', w: 'a' } }],
    ['an empty alphabet', { alphabet: [], condition: { kind: 'begWt', w: 'a' } }],
    ['a symbol listed twice', { alphabet: ['a', 'a'], condition: { kind: 'begWt', w: 'a' } }],
    ['a two-character symbol', { alphabet: ['ab'], condition: { kind: 'begWt', w: 'a' } }],
    ['a whitespace symbol', { alphabet: ['a', ' '], condition: { kind: 'begWt', w: 'a' } }],
    [
      'more than 36 symbols',
      {
        alphabet: [...'0123456789abcdefghijklmnopqrstuvwxyzA'],
        condition: { kind: 'begWt', w: 'a' },
      },
    ],
    ['a word over other symbols', { alphabet: ['a'], condition: { kind: 'endWt', w: 'ab' } }],
    [
      'a symbol on a range outside the alphabet',
      {
        alphabet: ['a'],
        condition: { kind: 'symbolOnRange', a: 'b', range: 'psGt', pos: { pos: 'fst', offset: 0 } },
      },
    ],
    [
      'a position word outside the alphabet',
      {
        alphabet: ['a'],
        condition: {
          kind: 'rangeCount',
          range: 'psLe',
          pos: { pos: 'fstOc', w: 'c', offset: 0 },
          cmp: '=',
          n: 1,
        },
      },
    ],
    ['an unexpected key', { alphabet: ALPHABET, condition: { kind: 'begWt', w: 'a', k: 1 } }],
    ['a oneOf with no words', { alphabet: ALPHABET, condition: { kind: 'oneOf', words: [] } }],
    [
      'a oneOf listing a word twice',
      { alphabet: ALPHABET, condition: { kind: 'oneOf', words: ['ab', 'b', 'ab'] } },
    ],
    [
      'a oneOf word outside the alphabet',
      { alphabet: ALPHABET, condition: { kind: 'oneOf', words: ['ab', 'ac'] } },
    ],
    [
      'a oneOf of more than 50 words',
      {
        alphabet: ALPHABET,
        condition: { kind: 'oneOf', words: Array.from({ length: 51 }, (_, i) => 'a'.repeat(i)) },
      },
    ],
    [
      'more than eight conditions',
      {
        alphabet: ALPHABET,
        condition: { op: 'or', args: Array.from({ length: 9 }, () => ({ kind: 'begWt', w: 'a' })) },
      },
    ],
  ])('rejects %s', (_name, spec) => {
    expect(ok(spec)).toBe(false);
  });
});

describe('moselSpecFormField (multipart)', () => {
  const spec = { alphabet: ['a'], condition: { kind: 'begWt', w: 'a' } };

  it('parses a JSON string', () => {
    expect(moselSpecFormField.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it('reads absent as "leave it" and blank as "remove it"', () => {
    expect(moselSpecFormField.parse(undefined)).toBeUndefined();
    expect(moselSpecFormField.parse('  ')).toBeNull();
  });

  it('rejects text that is not JSON', () => {
    expect(moselSpecFormField.safeParse('begWt ab').success).toBe(false);
  });
});
