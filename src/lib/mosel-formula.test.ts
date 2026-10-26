import { describe, expect, it } from 'vitest';

import { formatMoselFormula, parseMoselFormula } from '@/lib/mosel-formula';
import type { MoselCondition } from '@/schemas/mosel';

function parse(text: string): MoselCondition {
  const result = parseMoselFormula(text);
  if (!result.ok) throw new Error(`${text}: ${result.error} (at ${result.index})`);
  return result.condition;
}

function errorOf(text: string): { error: string; index: number } {
  const result = parseMoselFormula(text);
  if (result.ok) throw new Error(`${text} parsed`);
  return { error: result.error, index: result.index };
}

describe('parseMoselFormula', () => {
  it('reads every kind of condition', () => {
    expect(parse("begWt 'ab'")).toEqual({ kind: 'begWt', w: 'ab' });
    expect(parse('endWt "ab"')).toEqual({ kind: 'endWt', w: 'ab' });
    expect(parse("|indOf 'a'| >= 2")).toEqual({ kind: 'count', w: 'a', cmp: '>=', n: 2 });
    expect(parse("|indOf 'a'| == 2")).toEqual({ kind: 'count', w: 'a', cmp: '=', n: 2 });
    expect(parse("|indOf 'a'| ≠ 2")).toEqual({ kind: 'count', w: 'a', cmp: '!=', n: 2 });
    expect(parse("|indOf 'a'| < 2")).toEqual({ kind: 'count', w: 'a', cmp: '<', n: 2 });
    expect(parse("|indOf 'ab'| mod 3 = 1")).toEqual({
      kind: 'countMod',
      w: 'ab',
      m: 3,
      cmp: '=',
      r: 1,
    });
    expect(parse('|s| % 3 != 0')).toEqual({ kind: 'lengthMod', m: 3, cmp: '!=', r: 0 });
    expect(parse('|all| >= 3')).toEqual({ kind: 'length', cmp: '>=', n: 3 });
    expect(parse('sum(s) % 3 = 0')).toEqual({ kind: 'sumMod', m: 3, cmp: '=', r: 0 });
    expect(parse('intBase(2) % 3 = 0')).toEqual({
      kind: 'valueMod',
      base: 2,
      m: 3,
      cmp: '=',
      r: 0,
    });
    expect(parse('INTBASE(16)mod 5>=2')).toEqual({
      kind: 'valueMod',
      base: 16,
      m: 5,
      cmp: '>=',
      r: 2,
    });
    expect(parse("oneOf('a', 'ab', 'ba')")).toEqual({ kind: 'oneOf', words: ['a', 'ab', 'ba'] });
    expect(parse('ONEOF("",\'b\')')).toEqual({ kind: 'oneOf', words: ['', 'b'] });
    expect(parse("oneOf('ab')")).toEqual({ kind: 'oneOf', words: ['ab'] });
    expect(parse('true')).toEqual({ kind: 'true' });
    expect(parse('FALSE')).toEqual({ kind: 'false' });
    expect(parse('isEmpty')).toEqual({ kind: 'isEmpty' });
  });

  it('reads a symbol at a position, bare or quoted', () => {
    expect(parse('a@fst')).toEqual({ kind: 'symbolFromStart', a: 'a', k: 0 });
    expect(parse("'a'@(fst + 2)")).toEqual({ kind: 'symbolFromStart', a: 'a', k: 2 });
    expect(parse('b @ last - 2')).toEqual({ kind: 'symbolFromEnd', a: 'b', k: 2 });
    expect(parse('1@(last + 1 - 3)')).toEqual({ kind: 'symbolFromEnd', a: '1', k: 2 });
    expect(parse("'#'@last")).toEqual({ kind: 'symbolFromEnd', a: '#', k: 0 });
    expect(parse('NOTa@last')).toEqual({
      op: 'not',
      args: [{ kind: 'symbolFromEnd', a: 'a', k: 0 }],
    });
    expect(parse('a@all')).toEqual({ kind: 'periodicSymbol', a: 'a', m: 1, r: 0 });
    expect(parse('a@posMod(2, 1)')).toEqual({ kind: 'periodicSymbol', a: 'a', m: 2, r: 1 });
  });

  it('reads positions, ranges and their sizes', () => {
    expect(parse("fstOc 'a' < fstOc 'b'")).toEqual({
      kind: 'positionCompare',
      left: { pos: 'fstOc', w: 'a', offset: 0 },
      cmp: '<',
      right: { pos: 'fstOc', w: 'b', offset: 0 },
    });
    expect(parse("lastOc 'ab' + 1 = last")).toEqual({
      kind: 'positionCompare',
      left: { pos: 'lastOc', w: 'ab', offset: 1 },
      cmp: '=',
      right: { pos: 'last', offset: 0 },
    });
    expect(parse("b@psGt fstOc 'b'")).toEqual({
      kind: 'symbolOnRange',
      a: 'b',
      range: 'psGt',
      pos: { pos: 'fstOc', w: 'b', offset: 0 },
    });
    expect(parse("|psLe fstOc 'b'| % 2 = 1")).toEqual({
      kind: 'rangeCountMod',
      range: 'psLe',
      pos: { pos: 'fstOc', w: 'b', offset: 0 },
      m: 2,
      cmp: '=',
      r: 1,
    });
    expect(parse('|psLt last - 1| >= 2')).toEqual({
      kind: 'rangeCount',
      range: 'psLt',
      pos: { pos: 'last', offset: -1 },
      cmp: '>=',
      n: 2,
    });
  });

  it('reads IMPLIES (right associative) and IFF (left associative) below OR', () => {
    const a = { kind: 'begWt', w: 'a' } as const;
    const b = { kind: 'endWt', w: 'b' } as const;
    const c = { kind: 'endWt', w: 'c' } as const;
    expect(parse("begWt 'a' IMPLIES endWt 'b' OR endWt 'c'")).toEqual({
      op: 'implies',
      args: [a, { op: 'or', args: [b, c] }],
    });
    expect(parse("begWt 'a' -> endWt 'b' → endWt 'c'")).toEqual({
      op: 'implies',
      args: [a, { op: 'implies', args: [b, c] }],
    });
    expect(parse("begWt 'a' iff endWt 'b' <-> endWt 'c'")).toEqual({
      op: 'iff',
      args: [{ op: 'iff', args: [a, b] }, c],
    });
    expect(parse("begWt 'a' ↔ endWt 'b' -> endWt 'c'")).toEqual({
      op: 'iff',
      args: [a, { op: 'implies', args: [b, c] }],
    });
  });

  it('reads the examples without spaces and in any case', () => {
    expect(parse('begWt\'a\'AND|indOf"ab"|%2=1')).toEqual({
      op: 'and',
      args: [
        { kind: 'begWt', w: 'a' },
        { kind: 'countMod', w: 'ab', m: 2, cmp: '=', r: 1 },
      ],
    });
    expect(parse("|indOf 'a'| >= 2 OR |indOf 'b'| >= 2")).toEqual({
      op: 'or',
      args: [
        { kind: 'count', w: 'a', cmp: '>=', n: 2 },
        { kind: 'count', w: 'b', cmp: '>=', n: 2 },
      ],
    });
    expect(parse("not BEGWT 'a' and endwt 'b'")).toEqual(parse("NOT begWt 'a' AND endWt 'b'"));
    expect(parse("|s|%2=0ORnot begWt'a'")).toEqual({
      op: 'or',
      args: [
        { kind: 'lengthMod', m: 2, cmp: '=', r: 0 },
        { op: 'not', args: [{ kind: 'begWt', w: 'a' }] },
      ],
    });
  });

  it('lets a word hold the other kind of quote', () => {
    expect(parse(`begWt "a'b"`)).toEqual({ kind: 'begWt', w: "a'b" });
  });

  it('binds NOT tightest, then AND, then OR', () => {
    const a = { kind: 'begWt', w: 'a' } as const;
    const b = { kind: 'endWt', w: 'b' } as const;
    const c = { kind: 'endWt', w: 'c' } as const;
    expect(parse("begWt 'a' OR endWt 'b' AND endWt 'c'")).toEqual({
      op: 'or',
      args: [a, { op: 'and', args: [b, c] }],
    });
    expect(parse("NOT begWt 'a' AND endWt 'b'")).toEqual({
      op: 'and',
      args: [{ op: 'not', args: [a] }, b],
    });
    expect(parse("begWt 'a' AND endWt 'b' AND endWt 'c'")).toEqual({ op: 'and', args: [a, b, c] });
  });

  it('follows parentheses', () => {
    const a = { kind: 'begWt', w: 'a' } as const;
    const b = { kind: 'endWt', w: 'b' } as const;
    const c = { kind: 'endWt', w: 'c' } as const;
    expect(parse("(begWt 'a' OR endWt 'b') AND endWt 'c'")).toEqual({
      op: 'and',
      args: [{ op: 'or', args: [a, b] }, c],
    });
    expect(parse("NOT (begWt 'a' AND endWt 'b')")).toEqual({
      op: 'not',
      args: [{ op: 'and', args: [a, b] }],
    });
    expect(parse("((begWt 'a'))")).toEqual(a);
  });

  it('says what is wrong and where', () => {
    expect(errorOf("begWt 'ab")).toEqual({ error: "This word has no closing '.", index: 6 });
    expect(errorOf('begWt ab')).toMatchObject({ index: 6 });
    expect(errorOf("begWt 'a' AND")).toMatchObject({
      error: expect.stringContaining('the end of the formula'),
    });
    expect(errorOf("begWt 'a' endWt 'b'").error).toMatch(/Expected AND, OR/);
    expect(errorOf("(begWt 'a'")).toEqual({ error: "This '(' is never closed.", index: 0 });
    expect(errorOf("begWt 'a')").error).toBe("This ')' has no matching '('.");
    expect(errorOf("startsWith 'a'")).toEqual({ error: "Unknown word 'startsWith'.", index: 0 });
    expect(errorOf("begWt ''").error).toBe('The word must not be empty.');
    expect(errorOf("oneOf 'a'").error).toMatch(/written oneOf\('w1', 'w2', …\)/);
    expect(errorOf('oneOf()').error).toMatch(/Expected a word in quotes/);
    expect(errorOf("oneOf('a', 'b',)").error).toMatch(/Expected a word in quotes/);
    expect(errorOf("oneOf('a' 'b')").error).toMatch(/Expected ',' or '\)'/);
    expect(errorOf("oneOf('a', 'ab', 'a')")).toEqual({ error: "'a' is listed twice.", index: 17 });
    const many = Array.from({ length: 51 }, (_, i) => `'${'a'.repeat(i)}'`).join(', ');
    expect(errorOf(`oneOf(${many})`).error).toMatch(/at most 50 words/);
    expect(errorOf('sum(s) >= 2').error).toMatch(/only be compared modulo/);
    expect(errorOf('intBase(2) = 3').error).toMatch(/only be compared modulo/);
    expect(errorOf('intBase 2 % 3 = 0').error).toMatch(/written intBase\(b\)/);
    expect(errorOf('intBase(1) % 3 = 0').error).toBe('The base must be at least 2.');
    expect(errorOf('intBase(37) % 3 = 0').error).toMatch(/at most 36/);
    expect(errorOf("|indOf 'a'| % 2 = 2").error).toMatch(/smaller than the modulus/);
    expect(errorOf("|indOf 'a'| % 0 = 0").error).toMatch(/at least 1/);
    expect(errorOf('a@(fst - 1)').error).toMatch(/before the first position/);
    expect(errorOf('a@(last + 1)').error).toMatch(/after the last position/);
    expect(errorOf("a@fstOc 'b'").error).toMatch(/counted from fst or last/);
    expect(errorOf('ab@fst')).toMatchObject({ error: expect.stringMatching(/Only one symbol/) });
    expect(errorOf("'ab'@fst").error).toMatch(/Only one symbol/);
    expect(errorOf('a@(last - 11)').error).toMatch(/at most 10/);
    expect(errorOf('a@(last - 6 - 5)').error).toMatch(/moved by at most 10/);
    expect(errorOf('a@posMod(2, 2)').error).toMatch(/smaller than the modulus/);
    expect(errorOf("fstOc 'a' begWt 'b'").error).toMatch(/comparison between the two positions/);
    expect(errorOf("|indOf 'a'| >= 1000").error).toMatch(/at most 100/);
    expect(errorOf("begWt 'a' & endWt 'b'")).toEqual({ error: "Unexpected '&'.", index: 10 });
  });
});

describe('formatMoselFormula', () => {
  const cases = [
    "begWt 'ab'",
    "|indOf 'a'| >= 2 OR |indOf 'b'| >= 2",
    "begWt 'a' AND |indOf 'ab'| % 2 = 1",
    "(begWt 'a' OR endWt 'b') AND NOT |s| % 3 = 0",
    "NOT (begWt 'a' AND endWt 'b') OR sum(s) % 3 = 0",
    'intBase(2) % 3 = 0 AND NOT intBase(16) % 5 != 2',
    "oneOf('', 'a', 'ab') OR endWt 'bb'",
    "NOT NOT endWt 'a'",
    "(begWt 'a' AND endWt 'b') AND endWt 'c'",
    `begWt "a'b"`,
    "|indOf 'a'| != 0 AND |s| < 4 AND |s| % 3 > 0",
    "a@fst AND b@(fst + 2) AND a@last AND '#'@(last - 3)",
    'a@all OR a@posMod(2, 1)',
    "fstOc 'a' + 1 < lastOc 'b' - 2 IMPLIES b@psGe fst + 1",
    "|psLe fstOc 'b'| % 2 = 1 IFF |psGt last - 1| = 1",
    "(begWt 'a' IMPLIES endWt 'b') IMPLIES endWt 'c'",
    "begWt 'a' IMPLIES (endWt 'b' IMPLIES endWt 'c')",
    "(begWt 'a' IFF endWt 'b') IFF true",
    "NOT (begWt 'a' OR isEmpty) IFF false",
  ];

  it.each(cases)('writes %s back as it was', (text) => {
    expect(formatMoselFormula(parse(text))).toBe(text);
  });
});

describe('formatting then parsing', () => {
  const leaves: MoselCondition[] = [
    { kind: 'true' },
    { kind: 'false' },
    { kind: 'isEmpty' },
    { kind: 'count', w: "it's", cmp: '!=', n: 0 },
    { kind: 'countMod', w: 'ab', m: 4, cmp: '<=', r: 2 },
    { kind: 'length', cmp: '>', n: 5 },
    { kind: 'oneOf', words: ['', "it's", 'a"b', '#'] },
    { kind: 'lengthMod', m: 2, cmp: '=', r: 1 },
    { kind: 'sumMod', m: 3, cmp: '!=', r: 0 },
    { kind: 'valueMod', base: 36, m: 7, cmp: '<', r: 6 },
    { kind: 'symbolFromStart', a: 'Z', k: 10 },
    { kind: 'symbolFromEnd', a: "'", k: 1 },
    { kind: 'periodicSymbol', a: '0', m: 3, r: 2 },
    { kind: 'periodicSymbol', a: 'b', m: 1, r: 0 },
    {
      kind: 'positionCompare',
      left: { pos: 'fst', offset: 10 },
      cmp: '>=',
      right: { pos: 'lastOc', w: 'aba', offset: -10 },
    },
    { kind: 'symbolOnRange', a: 'a', range: 'psLt', pos: { pos: 'last', offset: -1 } },
    {
      kind: 'rangeCount',
      range: 'psGe',
      pos: { pos: 'fstOc', w: 'b', offset: 2 },
      cmp: '<',
      n: 3,
    },
    {
      kind: 'rangeCountMod',
      range: 'psGt',
      pos: { pos: 'lastOc', w: 'a', offset: 0 },
      m: 2,
      cmp: '=',
      r: 0,
    },
  ];

  it.each(leaves.map((leaf) => [formatMoselFormula(leaf), leaf] as const))(
    'reads %s back into the same leaf',
    (text, leaf) => {
      expect(parse(text)).toEqual(leaf);
    },
  );
});
