# Problems

The **Problems** page is the reusable problem bank for a course. Create a problem once, then add it to one or more assignments.

## Supported problem types

AFCT supports these problem types in the course interface:

- Finite Automaton
- Push-Down Automaton
- Context-Free Grammar
- Regular Expression

The answer file is the solution AFCT uses to display the expected model and, when enabled, grade student submissions. It is also what lets the [Similarity](similarity.md) tab say when matching work is simply the answer you posted. Accepted file extensions include `.txt`, `.fa`, `.pda`, `.cfg`, `.re`, and `.jff`. The file must contain valid JFLAP XML and its type must match the problem type.

A finite automaton problem can be defined by a [language description](#language-description-finite-automata) instead of an answer file, or by both.

## Create a problem

Create Problem is a short guided wizard with four steps: Details, Type, Answer, and Review.

1. Open the course and select **Problems**.
2. Select **Create Problem**.
3. On **Details**, enter a clear title and an optional description. The description accepts formatting, equations and links, see [Formatted descriptions](descriptions.md).
4. On **Type**, choose the problem type. For a finite automaton or push-down automaton, choose a state limit or leave it unlimited; for a finite automaton, turn on **Deterministic** when the student's answer must be deterministic.
5. On **Answer**, upload the answer file. For a finite automaton you can give a **Language Description** instead, or as well (see below).
6. On **Review**, confirm your choices and select **Create Problem**.

A problem in the bank is only the definition. Points, the accepted-submission limit, and automatic grading are set per assignment, not on the problem itself (see below).

You can also create a problem from inside an assignment. In that case, AFCT adds the new problem to the problem bank and to the open assignment.

To try an answer file against a sample submission before you build a problem around it, see the [Evaluator Sandbox](evaluator-sandbox.md).

## Language description (finite automata)

A finite automaton problem can describe its language in MOSEL, the condition language used by
the GOAL Lab's DFA analysis, instead of with an answer file. A description has two parts: the
**alphabet**, the symbols the strings are made of, and a **condition** the accepted strings
satisfy. The language is every string over the alphabet that satisfies the condition. For example,
"strings of 0's followed by 1's" (the regular expression `0*1*`) is

```text
Alphabet:  0, 1
Condition: |indOf '10'| = 0
```

since a string over `0` and `1` has that shape exactly when `10` never occurs in it.

Write the alphabet as single-character symbols separated by commas or spaces (`a, b` or `0 1`), up
to 36 of them. The condition can only name symbols in the alphabet: `endWt 'ac'` over `a, b` is
refused, since a `c` never occurs.

### How a problem with a description is graded

- **No answer file:** submissions are marked against the description. The evaluator builds the
  automaton the description stands for and runs the same equivalence check an answer file would
  get, so a student sees the same verdict and the same kind of feedback as they would from an
  answer file for that language. When a wrong answer has more than one example string to show,
  which one appears depends on how the answer automaton happens to be laid out, so it can differ
  from the one a particular answer file would pick (two answer files for the same language can
  differ in the same way). As with an answer
  file, a submission that reads a symbol outside the alphabet, or never reads one of its symbols,
  is refused as having a different alphabet.
- **An answer file as well:** the answer file decides what is correct, and the description is
  used only for the analysis below. If the two describe different languages, or the answer file
  reads different symbols from the alphabet, the evaluator says so in its warnings.

Either way, the description is what [partial credit](rubrics.md) will be built on.

Pick the condition by the language you have in mind:

| Condition               | Meaning                                                                                                                                                                                 | Example language                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `begWt 'w'`             | begins with `w`                                                                                                                                                                         | "starts with ab": `begWt 'ab'`                                                                          |
| `endWt 'w'`             | ends with `w`                                                                                                                                                                           | "ends with ab": `endWt 'ab'`                                                                            |
| `oneOf('w1', 'w2', …)`  | exactly one of the listed words (up to 50; `''` is the empty string)                                                                                                                    | "exactly the strings a, ab and ba": `oneOf('a', 'ab', 'ba')`; "a or the empty string": `oneOf('', 'a')` |
| `\|indOf 'w'\| >= k`    | the number of occurrences of `w` (overlapping ones count) compared with `k`                                                                                                             | "contains aa": `\|indOf 'aa'\| >= 1`; "no b": `\|indOf 'b'\| = 0`                                       |
| `\|indOf 'w'\| % m = r` | the number of occurrences of `w`, mod `m`                                                                                                                                               | "an even number of a's": `\|indOf 'a'\| % 2 = 0`                                                        |
| `\|s\| >= k`            | the length (`\|all\|` also works)                                                                                                                                                       | "at least 3 symbols": `\|s\| >= 3`                                                                      |
| `\|s\| % m = r`         | the length, mod `m`                                                                                                                                                                     | "length not divisible by 3": `\|s\| % 3 != 0`                                                           |
| `sum(s) % m = r`        | the sum of the digits, mod `m` (other symbols add nothing)                                                                                                                              | "digit sum divisible by 3": `sum(s) % 3 = 0`                                                            |
| `intBase(b) % m = r`    | the string read as a number in base `b` (2 to 36; digits `0`-`9`, then `a`-`z` in either case), mod `m`; symbols that are not digits in base `b` are skipped, and the empty string is 0 | "binary numbers divisible by 3": `intBase(2) % 3 = 0`                                                   |
| `a@(fst + k)`           | the symbol `k` places after the first is `a` (`a@fst` for the first)                                                                                                                    | "the third symbol is a": `a@(fst + 2)`                                                                  |
| `a@(last - k)`          | the symbol `k` places before the last is `a` (`a@last` for the last)                                                                                                                    | "the second-to-last symbol is b": `b@(last - 1)`                                                        |
| `a@all`                 | every symbol is `a`                                                                                                                                                                     | "only a's": `a@all`                                                                                     |
| `a@posMod(m, r)`        | every position `j` with `j % m = r` holds `a`, counting positions from 1                                                                                                                | "every odd position is a": `a@posMod(2, 1)`                                                             |
| `P < P`                 | compares two positions; false when either does not exist                                                                                                                                | "the first a comes before the first b": `fstOc 'a' < fstOc 'b'`                                         |
| `a@psGt P`              | every symbol after `P` is `a` (also `psGe`, from `P` on; `psLt`, before `P`; `psLe`, up to `P`); false when `P` does not exist                                                          | "after the first b, only b's": `b@psGt fstOc 'b'`                                                       |
| `\|psLe P\| % m = r`    | how many positions are up to `P` (or before, after, from it, as above), compared or mod `m`                                                                                             | "the first b is at an odd position": `\|psLe fstOc 'b'\| % 2 = 1`                                       |
| `isEmpty`               | the empty string                                                                                                                                                                        | "nonempty strings that start with a, or the empty string": `begWt 'a' OR isEmpty`                       |
| `true`, `false`         | every string, no string                                                                                                                                                                 | useful while drafting                                                                                   |

A position `P` is `fst` (the first symbol), `last` (the last symbol), `fstOc 'w'` or `lastOc 'w'`
(where the first or last occurrence of `w` starts), optionally moved with `+ k` or `- k` (up to
10). Every comparison may be `=`, `!=`, `<`, `<=`, `>` or `>=` (`==`, `≠`, `≤` and `≥` also work).
The symbol before `@` is one letter or digit, or any one symbol in quotes (`'#'@last`).

Words go in single or double quotes (`'ab'` or `"ab"`), and `mod` may be written instead of `%`.
Combine conditions with `NOT`, `AND`, `OR`, `IMPLIES` (or `->`) and `IFF` (or `<->`), in any case,
using up to eight conditions in all. They bind in that order, `NOT` tightest, so
`begWt 'a' OR endWt 'b' AND NOT endWt 'ab'` means `begWt 'a' OR (endWt 'b' AND (NOT endWt 'ab'))`
and `begWt 'a' IMPLIES endWt 'b' OR isEmpty` means `begWt 'a' IMPLIES (endWt 'b' OR isEmpty)`;
use parentheses for any other grouping. Spaces are optional, so `begWt'a'AND|indOf"ab"|%2=1` is
also a formula. If something is wrong, the field says what and at which character.

A symbol of the alphabet that a condition does not mention still counts where the condition
depends on it: it takes up a position, adds to the length, and breaks a match of a word. Where the
condition does not depend on it, it changes nothing, so over `0, 1, x`, `sum(s) % 4 = 0` means
"the digits add up to a multiple of 4", whatever `x`s the string has. Likewise
`intBase(2) % 3 = 0` reads only the `0`s and `1`s, so `1x1` is read as `11`, which is 3.

The API takes and returns the description as JSON (the `moselSpec` field; its shape is in
`src/schemas/mosel.ts`), which is what the formula is translated to.

When a description is present, the evaluator also checks every state of a student's automaton
against it and records which states are consistent with the language and which are not. That
analysis is stored with the attempt for staff; **it does not change whether an answer is marked
correct**, and **students are not shown it**. Try a description in the
[Evaluator Sandbox](evaluator-sandbox.md) before you rely on it.

The problem table shows the description where the answer file would be, for a problem that has no
answer file. Each attempt records the description it was marked against, just as it records the
answer file, so editing the description later does not re-mark work already graded. A problem
always keeps something to mark against: you cannot take the description off a problem with no
answer file, or change its type, without uploading an answer file.

Duplicating or importing a problem copies its description.

## Review and edit a problem

The problem table shows the title, type, answer file, state limit, deterministic requirement, and creation date. A **Used** label means the problem belongs to at least one assignment.

Open **Manage** to:

- **View Answer** using the viewer for that problem type. The viewer has an **Open in the viewer** button on its toolbar, which shows the same thing in a window of its own for a machine too large to read comfortably in a panel, and closes the panel as it goes. That window holds several files as tabs, so opening a second one puts it beside the first rather than replacing it.
- **Edit Problem** details and replace the answer file
- **Duplicate Problem** to create a copy in the same bank
- **Delete Problem** when the problem is not used by an assignment

Editing a problem from the problem bank uses the same wizard and changes the definition only: title, description, type, state limit, deterministic requirement, answer file, and language description. If you change the problem type and keep the answer file already there, AFCT checks that it is valid for the new type and refuses the change if it is not, so a problem cannot end up claiming one type while its answer is another.

**Replacing an answer file does not re-mark work that has already been graded.** Each attempt records the answer file it was measured against, and a grade already given stands: it was a true statement about that work when it was made. Only submissions graded after the change are measured against the new file. If you want earlier work re-marked, re-run those submissions from the assignment's **Submissions** tab, which is a deliberate act rather than something a file upload does quietly.

Points, the accepted-submission limit, automatic grading and the [rubric](rubrics.md) belong to each assignment, not to the bank problem. Set them when you add the problem to an assignment, or change them later from the assignment's **Problems** tab (**Manage** the problem and open its settings). The same problem can carry different values in different assignments.

## Duplicate a problem

**Duplicate Problem** creates a fresh copy of an existing problem in the same bank. Edit the copy's title and description in the dialog; the type, state limit, deterministic requirement, and the answer file are copied from the original. The copy gets its own answer file, so replacing it later never touches the original. Once the copy is created you can edit any of the remaining details from **Edit Problem**.

## Import a problem from another course

**Import Problem** (next to Create Problem) copies a problem out of a different course you teach or assist into this one's bank. It is a short wizard:

1. **Source** - pick a course, then a problem. The course list shows every course where you are faculty or a TA (administrators see all courses), including archived courses.
2. **Details** - the title and description start as the source problem's; edit them or leave them as is.
3. **Review** - a summary before you import.

The type, state limit, deterministic requirement, and the answer file are copied from the source into a new problem here, with its own answer file, so the original in the other course is never affected. Edit the remaining details from **Edit Problem** afterward. To copy a problem _within_ the same course, use Duplicate instead.

## Before publishing

Open each answer with **View Answer** and check that it renders as expected. Then open the assignment and confirm its point values and submission limits. This quick check catches mismatched files and assignment-specific settings before students start submitting.
