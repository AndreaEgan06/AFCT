// src/lib/mosel-formula.ts
//
// MOSEL written the way staff write it on paper, e.g.
//
//   begWt 'a' AND |indOf "ab"| % 2 = 1
//   |indOf 'a'| >= 2 OR |indOf 'b'| >= 2
//   b@(last - 1) IMPLIES fstOc 'a' < fstOc 'b'
//
// and the translation between that text and the JSON condition the evaluator reads
// (src/schemas/mosel.ts). The JSON stays the stored and wire form; this is only how the
// dashboard lets people type it. It covers the closed, quantifier-free part of the language
// of Alur et al. (IJCAI 2013), plus sum(s), intBase(b), posMod(m, r) and oneOf(…), which are our
// own.
//
// Grammar (keywords and predicate names ignore case; spaces are optional):
//
//   formula := iff
//   iff     := implies ( (IFF | '<->' | '↔') implies )*         -- left associative
//   implies := or ( (IMPLIES | '->' | '→') implies )?           -- right associative
//   or      := and ( OR and )*
//   and     := not ( AND not )*
//   not     := NOT not | primary
//   primary := '(' formula ')' | atom
//   atom    := true | false | isEmpty | begWt WORD | endWt WORD
//            | oneOf '(' WORD ( ',' WORD )* ')'                 -- the empty word '' allowed
//            | '|' count '|' ( MOD NUMBER CMP NUMBER | CMP NUMBER )
//            | sum '(' s ')' MOD NUMBER CMP NUMBER
//            | intBase '(' NUMBER ')' MOD NUMBER CMP NUMBER
//            | SYMBOL '@' target
//            | pos CMP pos
//   count   := indOf WORD | all | s | range
//   target  := pos | '(' pos ')' | range | all | posMod '(' NUMBER ',' NUMBER ')'
//   range   := (psLt | psLe | psGt | psGe) pos
//   pos     := (fst | last | fstOc WORD | lastOc WORD) ( ('+' | '-') NUMBER )*
//   CMP     := '<' | '<=' | '≤' | '=' | '==' | '!=' | '≠' | '>=' | '≥' | '>'
//   SYMBOL  := one letter or digit, or a one-symbol WORD
//   WORD    := '…' | "…"
//   MOD     := '%' | mod
//
// So NOT binds tightest, then AND, OR, IMPLIES and IFF; parentheses override that.
import {
  MOSEL_LIMITS,
  MOSEL_RANGES,
  type MoselComparison,
  type MoselCondition,
  type MoselLeaf,
  type MoselPosition,
  type MoselRange,
} from '@/schemas/mosel';

export type MoselFormulaResult =
  { ok: true; condition: MoselCondition } | { ok: false; error: string; index: number };

type Token =
  | { type: 'word'; value: string; raw: string; index: number } // value is lowercased
  | { type: 'string'; value: string; index: number }
  | { type: 'number'; value: number; index: number }
  | { type: 'symbol'; value: string; index: number }
  | { type: 'constant'; value: string; index: number } // the a in a@…, written unquoted
  | { type: 'end'; index: number };

class FormulaError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
  }
}

/**
 * Every word the grammar knows. A run of letters is split into these greedily, longest first,
 * so `'a'ANDNOT begWt` and `0ORbegWt'a'` read the way they look even without spaces.
 */
const KNOWN_WORDS = [
  'and',
  'or',
  'not',
  'implies',
  'iff',
  'true',
  'false',
  'isempty',
  'begwt',
  'endwt',
  'oneof',
  'indof',
  'all',
  's',
  'sum',
  'digsum',
  'intbase',
  'mod',
  'fst',
  'last',
  'fstoc',
  'lastoc',
  'pslt',
  'psle',
  'psgt',
  'psge',
  'posmod',
].sort((a, b) => b.length - a.length);

const COMPARISONS: Record<string, MoselComparison> = {
  '<': '<',
  '<=': '<=',
  '≤': '<=',
  '=': '=',
  '==': '=',
  '!=': '!=',
  '≠': '!=',
  '>=': '>=',
  '≥': '>=',
  '>': '>',
};

// Longest first, so `<->` is not read as `<`, `->` not as `-`, and `>=` not as `>`.
const SYMBOLS = [
  '<->',
  '->',
  ...Object.keys(COMPARISONS),
  '→',
  '↔',
  '(',
  ')',
  '|',
  '%',
  '@',
  '+',
  '-',
  ',',
].sort((a, b) => b.length - a.length);

const RANGE_NAMES = new Map<string, MoselRange>(MOSEL_RANGES.map((r) => [r.toLowerCase(), r]));

function splitWords(run: string, index: number): Token[] {
  const lower = run.toLowerCase();
  const tokens: Token[] = [];
  let at = 0;
  while (at < lower.length) {
    const known = KNOWN_WORDS.find((w) => lower.startsWith(w, at));
    if (!known) throw new FormulaError(`Unknown word '${run}'.`, index);
    tokens.push({
      type: 'word',
      value: known,
      raw: run.slice(at, at + known.length),
      index: index + at,
    });
    at += known.length;
  }
  return tokens;
}

/** Whether the next character after `from` that is not a space is '@'. */
function beforeAt(text: string, from: number): boolean {
  return /^\s*@/.test(text.slice(from));
}

const ONE_SYMBOL_BEFORE_AT =
  "Only one symbol can come before '@' (write other symbols in quotes, like '#'@fst).";

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      if (close === -1) throw new FormulaError(`This word has no closing ${ch}.`, i);
      tokens.push({ type: 'string', value: text.slice(i + 1, close), index: i });
      i = close + 1;
    } else if (/[0-9]/.test(ch)) {
      const digits = /^[0-9]+/.exec(text.slice(i))![0];
      if (beforeAt(text, i + digits.length)) {
        if (digits.length > 1) throw new FormulaError(ONE_SYMBOL_BEFORE_AT, i);
        tokens.push({ type: 'constant', value: digits, index: i });
      } else {
        tokens.push({ type: 'number', value: Number(digits), index: i });
      }
      i += digits.length;
    } else if (/[A-Za-z]/.test(ch)) {
      const run = /^[A-Za-z]+/.exec(text.slice(i))![0];
      if (beforeAt(text, i + run.length)) {
        // `NOTa@fst`: the last letter is the symbol, the rest are words.
        const last = run.length - 1;
        try {
          tokens.push(...splitWords(run.slice(0, last), i));
        } catch {
          throw new FormulaError(ONE_SYMBOL_BEFORE_AT, i);
        }
        tokens.push({ type: 'constant', value: run.charAt(last), index: i + last });
      } else {
        tokens.push(...splitWords(run, i));
      }
      i += run.length;
    } else {
      const symbol = SYMBOLS.find((s) => text.startsWith(s, i));
      if (!symbol) throw new FormulaError(`Unexpected '${ch}'.`, i);
      tokens.push({ type: 'symbol', value: symbol, index: i });
      i += symbol.length;
    }
  }
  tokens.push({ type: 'end', index: text.length });
  return tokens;
}

function describe(token: Token): string {
  switch (token.type) {
    case 'end':
      return 'the end of the formula';
    case 'string':
      return `'${token.value}'`;
    case 'word':
      return `'${token.raw}'`;
    default:
      return `'${token.value}'`;
  }
}

class Parser {
  private at = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): MoselCondition {
    const condition = this.iff();
    const next = this.peek();
    if (next.type !== 'end') {
      throw new FormulaError(
        next.type === 'symbol' && next.value === ')'
          ? "This ')' has no matching '('."
          : `Expected AND, OR, IMPLIES, IFF or the end of the formula, found ${describe(next)}.`,
        next.index,
      );
    }
    return condition;
  }

  // The token list always ends in an 'end' token, which nothing consumes, so these stay in range.
  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.at + ahead, this.tokens.length - 1)]!;
  }

  private next(): Token {
    return this.tokens[this.at++]!;
  }

  private isWord(...values: string[]): boolean {
    const token = this.peek();
    return token.type === 'word' && values.includes(token.value);
  }

  private isSymbol(...values: string[]): boolean {
    const token = this.peek();
    return token.type === 'symbol' && values.includes(token.value);
  }

  private expectWord(value: string, what: string): void {
    if (!this.isWord(value)) this.fail(`Expected ${what}`);
    this.at++;
  }

  private expectSymbol(value: string, what = `'${value}'`): void {
    if (!this.isSymbol(value)) this.fail(`Expected ${what}`);
    this.at++;
  }

  private fail(expected: string): never {
    const token = this.peek();
    throw new FormulaError(`${expected}, found ${describe(token)}.`, token.index);
  }

  private iff(): MoselCondition {
    let left = this.implies();
    while (this.isWord('iff') || this.isSymbol('<->', '↔')) {
      this.at++;
      left = { op: 'iff', args: [left, this.implies()] };
    }
    return left;
  }

  private implies(): MoselCondition {
    const left = this.or();
    if (!this.isWord('implies') && !this.isSymbol('->', '→')) return left;
    this.at++;
    return { op: 'implies', args: [left, this.implies()] };
  }

  /** One operator's operands, collected into a single node (`a AND b AND c` is one `and`). */
  private chain(op: 'and' | 'or', operand: () => MoselCondition): MoselCondition {
    const args = [operand()];
    while (this.isWord(op)) {
      this.at++;
      args.push(operand());
    }
    return args.length === 1 ? args[0]! : { op, args };
  }

  private or(): MoselCondition {
    return this.chain('or', () => this.and());
  }

  private and(): MoselCondition {
    return this.chain('and', () => this.not());
  }

  private not(): MoselCondition {
    if (this.isWord('not')) {
      this.at++;
      return { op: 'not', args: [this.not()] };
    }
    return this.primary();
  }

  private primary(): MoselCondition {
    if (this.isSymbol('(')) {
      const open = this.next();
      const inner = this.iff();
      if (!this.isSymbol(')')) {
        const token = this.peek();
        throw new FormulaError(
          token.type === 'end'
            ? "This '(' is never closed."
            : `Expected AND, OR, IMPLIES, IFF or ')', found ${describe(token)}.`,
          token.type === 'end' ? open.index : token.index,
        );
      }
      this.at++;
      return inner;
    }
    return this.atom();
  }

  private atom(): MoselLeaf {
    const token = this.peek();
    if (this.isWord('true', 'false', 'isempty')) {
      this.at++;
      return token.type === 'word' && token.value === 'isempty'
        ? { kind: 'isEmpty' }
        : { kind: token.type === 'word' && token.value === 'true' ? 'true' : 'false' };
    }
    if (this.isWord('begwt', 'endwt')) {
      this.at++;
      const w = this.word();
      return token.type === 'word' && token.value === 'begwt'
        ? { kind: 'begWt', w }
        : { kind: 'endWt', w };
    }
    if (this.isWord('oneof')) {
      this.at++;
      return { kind: 'oneOf', words: this.wordList() };
    }
    if (this.isWord('sum', 'digsum')) {
      this.at++;
      this.expectSymbol('(', "'(' (the digit sum is written sum(s))");
      this.expectWord('s', "'s' (the digit sum is written sum(s))");
      this.expectSymbol(')');
      return { kind: 'sumMod', ...this.modulo('The digit sum') };
    }
    if (this.isWord('intbase')) {
      this.at++;
      this.expectSymbol('(', "'(' (the value in base b is written intBase(b))");
      const base = this.number(MOSEL_LIMITS.maxBase, 'a base');
      if (base.value < 2) throw new FormulaError('The base must be at least 2.', base.index);
      this.expectSymbol(')');
      return { kind: 'valueMod', base: base.value, ...this.modulo('The value') };
    }
    if (this.isSymbol('|')) {
      this.at++;
      return this.size();
    }
    const after = this.peek(1);
    if (
      token.type === 'constant' ||
      (token.type === 'string' && after.type === 'symbol' && after.value === '@')
    ) {
      return this.symbolAt();
    }
    if (this.isWord('fst', 'last', 'fstoc', 'lastoc')) {
      const left = this.position();
      const cmp = this.comparison('Expected a comparison between the two positions');
      return { kind: 'positionCompare', left, cmp, right: this.position() };
    }
    this.fail(
      'Expected a condition (begWt, endWt, oneOf(…), |indOf …|, |s|, sum(s), intBase(b), a@…, a position comparison, true, false, isEmpty, NOT or a parenthesis)',
    );
  }

  /** What follows `|`: the set, its closing `|`, and the comparison. */
  private size(): MoselLeaf {
    if (this.isWord('s', 'all')) {
      this.at++;
      this.expectSymbol('|');
      if (this.isModulo()) return { kind: 'lengthMod', ...this.modulo('The length') };
      return { kind: 'length', ...this.count() };
    }
    const range = this.range();
    if (range) {
      const pos = this.position();
      this.expectSymbol('|', "'|' after the position");
      if (this.isModulo()) return { kind: 'rangeCountMod', range, pos, ...this.modulo('The size') };
      return { kind: 'rangeCount', range, pos, ...this.count() };
    }
    this.expectWord('indof', "indOf, s, all, psLt, psLe, psGt or psGe after '|'");
    const w = this.word();
    this.expectSymbol('|', "'|' after the word");
    if (this.isModulo()) return { kind: 'countMod', w, ...this.modulo('The count') };
    return { kind: 'count', w, ...this.count() };
  }

  /** `a@target`, with the symbol as the current token. */
  private symbolAt(): MoselLeaf {
    const token = this.next();
    if (token.type === 'string' && [...token.value].length !== 1) {
      throw new FormulaError(ONE_SYMBOL_BEFORE_AT, token.index);
    }
    const a = token.type === 'string' || token.type === 'constant' ? token.value : '';
    this.expectSymbol('@');
    if (this.isWord('all')) {
      this.at++;
      return { kind: 'periodicSymbol', a, m: 1, r: 0 };
    }
    if (this.isWord('posmod')) {
      this.at++;
      this.expectSymbol('(', "'(' (written posMod(m, r))");
      const m = this.modulus();
      this.expectSymbol(',', "',' (written posMod(m, r))");
      const r = this.remainder(m);
      this.expectSymbol(')');
      return { kind: 'periodicSymbol', a, m, r };
    }
    const range = this.range();
    if (range) return { kind: 'symbolOnRange', a, range, pos: this.position() };

    const start = this.peek();
    let pos: MoselPosition;
    if (this.isSymbol('(')) {
      this.at++;
      pos = this.position();
      this.expectSymbol(')');
    } else if (this.isWord('fst', 'last', 'fstoc', 'lastoc')) {
      pos = this.position();
    } else {
      this.fail("Expected a position, a range, all or posMod(m, r) after '@'");
    }
    if (pos.pos === 'fst') {
      if (pos.offset < 0) {
        throw new FormulaError(
          'This is before the first position, so it never holds.',
          start.index,
        );
      }
      return { kind: 'symbolFromStart', a, k: pos.offset };
    }
    if (pos.pos === 'last') {
      if (pos.offset > 0) {
        throw new FormulaError('This is after the last position, so it never holds.', start.index);
      }
      return { kind: 'symbolFromEnd', a, k: Math.abs(pos.offset) };
    }
    throw new FormulaError(
      `A symbol can only be placed at a position counted from fst or last, like a@(fst + 2) or a@(last - 1), not from ${pos.pos}.`,
      start.index,
    );
  }

  private range(): MoselRange | undefined {
    const token = this.peek();
    const range = token.type === 'word' ? RANGE_NAMES.get(token.value) : undefined;
    if (range) this.at++;
    return range;
  }

  private position(): MoselPosition {
    const token = this.peek();
    let pos: MoselPosition;
    if (this.isWord('fst') || this.isWord('last')) {
      this.at++;
      pos = { pos: token.type === 'word' && token.value === 'fst' ? 'fst' : 'last', offset: 0 };
    } else if (this.isWord('fstoc') || this.isWord('lastoc')) {
      this.at++;
      const w = this.word();
      pos = {
        pos: token.type === 'word' && token.value === 'fstoc' ? 'fstOc' : 'lastOc',
        w,
        offset: 0,
      };
    } else {
      this.fail('Expected a position (fst, last, fstOc or lastOc)');
    }
    // P + 1 - 2 is P - 1: the offsets fold into one.
    while (this.isSymbol('+', '-')) {
      const op = this.next();
      const sign = op.type === 'symbol' && op.value === '-' ? -1 : 1;
      const step = this.number(MOSEL_LIMITS.maxOffset, 'an offset');
      pos.offset += sign * step.value;
      if (Math.abs(pos.offset) > MOSEL_LIMITS.maxOffset) {
        throw new FormulaError(
          `A position can be moved by at most ${MOSEL_LIMITS.maxOffset}.`,
          step.index,
        );
      }
    }
    return pos;
  }

  private word(): string {
    const token = this.peek();
    if (token.type !== 'string') this.fail("Expected a word in quotes, like 'ab'");
    this.at++;
    if (token.value === '') throw new FormulaError('The word must not be empty.', token.index);
    if (token.value.length > MOSEL_LIMITS.maxWordLength) {
      throw new FormulaError(
        `Words are limited to ${MOSEL_LIMITS.maxWordLength} symbols.`,
        token.index,
      );
    }
    return token.value;
  }

  /** `( WORD, WORD, … )` after oneOf, where a word may be empty but may not be listed twice. */
  private wordList(): string[] {
    this.expectSymbol('(', "'(' (written oneOf('w1', 'w2', …))");
    const words: string[] = [];
    for (;;) {
      const token = this.peek();
      if (token.type !== 'string') this.fail("Expected a word in quotes, like 'ab' or ''");
      this.at++;
      if (token.value.length > MOSEL_LIMITS.maxWordLength) {
        throw new FormulaError(
          `Words are limited to ${MOSEL_LIMITS.maxWordLength} symbols.`,
          token.index,
        );
      }
      if (words.includes(token.value)) {
        throw new FormulaError(`'${token.value}' is listed twice.`, token.index);
      }
      if (words.length === MOSEL_LIMITS.maxWords) {
        throw new FormulaError(`oneOf lists at most ${MOSEL_LIMITS.maxWords} words.`, token.index);
      }
      words.push(token.value);
      if (!this.isSymbol(',')) break;
      this.at++;
    }
    this.expectSymbol(')', "',' or ')'");
    return words;
  }

  private number(max: number, what: string): { value: number; index: number } {
    const token = this.peek();
    if (token.type !== 'number') this.fail(`Expected ${what}`);
    this.at++;
    if (token.value > max) {
      throw new FormulaError(`${capitalize(what)} must be at most ${max}.`, token.index);
    }
    return { value: token.value, index: token.index };
  }

  private modulus(): number {
    const m = this.number(MOSEL_LIMITS.maxModulus, 'a modulus');
    if (m.value < 1) throw new FormulaError('The modulus must be at least 1.', m.index);
    return m.value;
  }

  private remainder(m: number): number {
    const r = this.number(MOSEL_LIMITS.maxModulus, 'a remainder');
    if (r.value >= m) {
      throw new FormulaError(`The remainder must be smaller than the modulus (${m}).`, r.index);
    }
    return r.value;
  }

  private isModulo(): boolean {
    return this.isSymbol('%') || this.isWord('mod');
  }

  /** `MOD m CMP r`, after the quantity it applies to. */
  private modulo(subject: string): { m: number; cmp: MoselComparison; r: number } {
    if (this.isModulo()) {
      this.at++;
    } else {
      this.fail(`${subject} can only be compared modulo a number, so expected '%' or mod`);
    }
    const m = this.modulus();
    const cmp = this.comparison('Expected a comparison (=, !=, <, <=, >=, >)');
    return { m, cmp, r: this.remainder(m) };
  }

  /** `CMP n`, after a size. */
  private count(): { cmp: MoselComparison; n: number } {
    const cmp = this.comparison("Expected a comparison (>=, >, =, !=, <=, <) or '%'");
    return { cmp, n: this.number(MOSEL_LIMITS.maxCount, 'a count').value };
  }

  private comparison(expected: string): MoselComparison {
    const token = this.peek();
    const cmp = token.type === 'symbol' ? COMPARISONS[token.value] : undefined;
    if (!cmp) this.fail(expected);
    this.at++;
    return cmp;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Reads a formula into the JSON condition, or says what is wrong and where (a 0-based index). */
export function parseMoselFormula(text: string): MoselFormulaResult {
  try {
    return { ok: true, condition: new Parser(tokenize(text)).parse() };
  } catch (error) {
    if (error instanceof FormulaError)
      return { ok: false, error: error.message, index: error.index };
    throw error;
  }
}

function quote(w: string): string {
  return w.includes("'") ? `"${w}"` : `'${w}'`;
}

/** The a in a@…: bare when the tokenizer reads it back as a symbol, quoted otherwise. */
function symbolText(a: string): string {
  return /^[A-Za-z0-9]$/.test(a) ? a : quote(a);
}

function formatPosition(pos: MoselPosition): string {
  const base = 'w' in pos ? `${pos.pos} ${quote(pos.w)}` : pos.pos;
  if (pos.offset === 0) return base;
  return `${base} ${pos.offset > 0 ? '+' : '-'} ${Math.abs(pos.offset)}`;
}

function formatLeaf(leaf: MoselLeaf): string {
  switch (leaf.kind) {
    case 'true':
    case 'false':
    case 'isEmpty':
      return leaf.kind;
    case 'begWt':
      return `begWt ${quote(leaf.w)}`;
    case 'endWt':
      return `endWt ${quote(leaf.w)}`;
    case 'oneOf':
      return `oneOf(${leaf.words.map(quote).join(', ')})`;
    case 'count':
      return `|indOf ${quote(leaf.w)}| ${leaf.cmp} ${leaf.n}`;
    case 'countMod':
      return `|indOf ${quote(leaf.w)}| % ${leaf.m} ${leaf.cmp} ${leaf.r}`;
    case 'length':
      return `|s| ${leaf.cmp} ${leaf.n}`;
    case 'lengthMod':
      return `|s| % ${leaf.m} ${leaf.cmp} ${leaf.r}`;
    case 'sumMod':
      return `sum(s) % ${leaf.m} ${leaf.cmp} ${leaf.r}`;
    case 'valueMod':
      return `intBase(${leaf.base}) % ${leaf.m} ${leaf.cmp} ${leaf.r}`;
    case 'symbolFromStart':
      return `${symbolText(leaf.a)}@${leaf.k === 0 ? 'fst' : `(fst + ${leaf.k})`}`;
    case 'symbolFromEnd':
      return `${symbolText(leaf.a)}@${leaf.k === 0 ? 'last' : `(last - ${leaf.k})`}`;
    case 'periodicSymbol':
      return `${symbolText(leaf.a)}@${leaf.m === 1 ? 'all' : `posMod(${leaf.m}, ${leaf.r})`}`;
    case 'positionCompare':
      return `${formatPosition(leaf.left)} ${leaf.cmp} ${formatPosition(leaf.right)}`;
    case 'symbolOnRange':
      return `${symbolText(leaf.a)}@${leaf.range} ${formatPosition(leaf.pos)}`;
    case 'rangeCount':
      return `|${leaf.range} ${formatPosition(leaf.pos)}| ${leaf.cmp} ${leaf.n}`;
    case 'rangeCountMod':
      return `|${leaf.range} ${formatPosition(leaf.pos)}| % ${leaf.m} ${leaf.cmp} ${leaf.r}`;
  }
}

const PRECEDENCE = { iff: 1, implies: 2, or: 3, and: 4, not: 5 } as const;

function precedence(condition: MoselCondition): number {
  return 'op' in condition ? PRECEDENCE[condition.op] : 6;
}

/**
 * Writes a condition back as a formula, with only the parentheses its structure needs, so
 * parsing the result gives the same condition back.
 */
export function formatMoselFormula(condition: MoselCondition): string {
  if (!('op' in condition)) return formatLeaf(condition);
  const own = PRECEDENCE[condition.op];
  // A nested operator of the same kind keeps its parentheses so it parses back to the same tree.
  const operand = (arg: MoselCondition) => {
    const text = formatMoselFormula(arg);
    const p = precedence(arg);
    return p < own || (p === own && condition.op !== 'not') ? `(${text})` : text;
  };
  if (condition.op === 'not') return `NOT ${operand(condition.args[0])}`;
  return (condition.args as MoselCondition[]).map(operand).join(` ${condition.op.toUpperCase()} `);
}

export type MoselAlphabetResult = { ok: true; symbols: string[] } | { ok: false; error: string };

/**
 * The alphabet as typed: single-character symbols separated by commas or spaces, such as
 * `0, 1` or `a b c`. Whether there are too many, or a repeat, is the schema's to say.
 */
export function parseMoselAlphabet(text: string): MoselAlphabetResult {
  const symbols = text.split(/[\s,]+/).filter((part) => part !== '');
  const long = symbols.find((part) => [...part].length !== 1);
  if (long !== undefined) {
    return {
      ok: false,
      error: `'${long}' is not one symbol. Separate the symbols with commas or spaces.`,
    };
  }
  return { ok: true, symbols };
}

/** An alphabet as the field shows it, e.g. `0, 1`. */
export function formatMoselAlphabet(symbols: readonly string[]): string {
  return symbols.join(', ');
}
