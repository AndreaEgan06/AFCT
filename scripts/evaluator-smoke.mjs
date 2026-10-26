// Golden smoke test for the shipped evaluator jar (jars/afct-evaluator.jar).
//
// WHY: the evaluator is the grading oracle. This test runs the *exact* jar that
// ships in the build against a set of known submission/answer pairs and asserts the
// correct/incorrect verdict, so a regressed, mis-swapped, or mis-invoked evaluator
// fails the build instead of silently mis-grading students. It deliberately reuses
// the production invocation (lib/java-runner.js) so it exercises the same JVM flags,
// env allowlist, timeout, and output cap the worker uses.
//
// ADD CASES: drop the .jff files in test/evaluator/cases and add an entry to
// test/evaluator/manifest.json. See test/evaluator/README.md.
//
// RUN: `npm run test:evaluator` (needs a JRE; the CI `evaluator` job sets one up).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaRunner from '../lib/java-runner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = path.join(ROOT, 'test', 'evaluator');
const CASES_DIR = path.join(EVAL_DIR, 'cases');
const JAR = path.join(ROOT, 'jars', 'afct-evaluator.jar');
const CFGANALYZER = path.join(ROOT, 'bin', 'cfganalyzer');

// Per-type CLI args appended after `--json <answer> <submission>`. Mirrors
// buildEvaluatorArgs() in src/lib/submission-worker.ts so this matches production.
function typeArgs(c) {
  if (c.type === 'FA') return [String(c.maxStates ?? -1), String(c.deterministic ?? false)];
  if (c.type === 'PDA') return [String(c.maxStates ?? -1)];
  return [];
}

// The jar prints only the result JSON on stdout in --json mode, but be tolerant of
// any stray leading output by falling back to the last JSON object.
function parseFeedback(stdout) {
  const trimmed = (stdout ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}\s*$/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`no JSON in evaluator output: ${trimmed.slice(0, 200)}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(EVAL_DIR, 'manifest.json'), 'utf8'));
const runner = new JavaRunner(JAR);

// The jar reads four env vars. Production sets all of them in src/lib/submission-worker.ts,
// so set them here too or this test would not grade exactly as production does. Without
// TIMEOUT_SECONDS the jar disables early stopping and logs a warning; without
// UPGRADED_FEEDBACK it warns and defaults it on. TIMEOUT_SECONDS is derived from the eval
// timeout in whole seconds, the same way production derives it.
const EVAL_TIMEOUT_MS = 60_000;
const evalEnv = {
  CFGANALYZER_BINARY: CFGANALYZER,
  CFGANALYZER_LIMIT: String(manifest.analyzerLimit ?? 15),
  TIMEOUT_SECONDS: String(Math.max(1, Math.floor(EVAL_TIMEOUT_MS / 1000))),
  UPGRADED_FEEDBACK: 'true',
};

console.log(
  `Evaluating ${manifest.cases.length} golden case(s) against ${path.relative(ROOT, JAR)}\n`,
);

/**
 * One run of the jar for a case. A case with `gradingConfig` sends it the way production does
 * (buildGradingConfig in src/lib/evaluator-runner.ts): `--grading-config -`, with the JSON on
 * stdin. One with `"answer": null` is marked against that config's MOSEL description
 * (`--answer-from-mosel`), as a problem with no answer file is. `answerFile` overrides the
 * case's answer, for the comparison run below.
 * RUBRIC: these cases guard that the shipped jar accepts the rubric and returns a score.
 */
async function evaluate(c, answerFile = c.answer) {
  const answerArgs =
    answerFile === null ? ['--answer-from-mosel'] : [path.join(CASES_DIR, answerFile)];
  const submission = path.join(CASES_DIR, c.submission);
  const gradingArgs = c.gradingConfig ? ['--grading-config', '-'] : [];
  const args = ['--json', ...gradingArgs, ...answerArgs, submission, ...typeArgs(c)];
  const { stdout } = await runner.execute(args, {
    timeout: EVAL_TIMEOUT_MS,
    maxMemoryMb: 512,
    env: evalEnv,
    ...(c.gradingConfig ? { input: JSON.stringify(c.gradingConfig) } : {}),
  });
  return parseFeedback(stdout);
}

let failures = 0;
for (const c of manifest.cases) {
  try {
    const feedback = await evaluate(c);
    if (typeof feedback.correct !== 'boolean') {
      throw new Error(
        `evaluator returned no boolean 'correct' (feedback: ${feedback.feedback ?? '?'})`,
      );
    }

    // Cases that assert the *rejection* path: the jar must refuse the file with a
    // recognizable message rather than crash or silently mark it wrong. Without this
    // a student uploading an unsupported machine could get a bare "incorrect".
    if (c.expectErrorContains) {
      const haystack = [feedback.feedback ?? '', ...(feedback.errors ?? [])]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(c.expectErrorContains.toLowerCase())) {
        failures++;
        console.error(
          `  FAIL  ${c.name}\n        expected an error containing "${c.expectErrorContains}"` +
            `\n        feedback: ${feedback.feedback ?? ''}`,
        );
        continue;
      }
    }

    // The score the rubric gave, and whether a MOSEL analysis came back.
    const gradingProblems = [];
    if ('expectScore' in c && feedback.score !== c.expectScore) {
      gradingProblems.push(`expected score=${c.expectScore}, got ${feedback.score}`);
    }
    if (c.expectConflictedStates !== undefined) {
      const conflicted = feedback.analysis?.counts?.CONFLICTED;
      if (conflicted !== c.expectConflictedStates) {
        gradingProblems.push(
          `expected ${c.expectConflictedStates} conflicted state(s) in the analysis, got ${conflicted}`,
        );
      }
    }
    // Marked against a description, the student must see exactly what an answer file for
    // the same language would have shown them.
    if (c.sameFeedbackAs) {
      const reference = await evaluate(c, c.sameFeedbackAs);
      for (const key of ['correct', 'feedback']) {
        if (feedback[key] !== reference[key]) {
          gradingProblems.push(
            `${key} differs from grading against ${c.sameFeedbackAs}: ` +
              `${JSON.stringify(feedback[key])} vs ${JSON.stringify(reference[key])}`,
          );
        }
      }
    }
    if (gradingProblems.length > 0) {
      failures++;
      console.error(`  FAIL  ${c.name}\n        ${gradingProblems.join('\n        ')}`);
      continue;
    }

    if (feedback.correct === c.expectCorrect) {
      console.log(`  ok    ${c.name}  (correct=${feedback.correct})`);
    } else {
      failures++;
      console.error(
        `  FAIL  ${c.name}\n        expected correct=${c.expectCorrect}, got ${feedback.correct}` +
          `\n        feedback: ${feedback.feedback ?? ''}`,
      );
    }
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${c.name}\n        evaluator error: ${err.message}`);
  }
}

const passed = manifest.cases.length - failures;
console.log(`\n${passed}/${manifest.cases.length} evaluator cases passed`);
process.exit(failures ? 1 : 0);
