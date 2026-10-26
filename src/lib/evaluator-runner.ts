// Running afct-evaluator.jar against two files, with no knowledge of submissions.
//
// Split out of submission-worker.ts so the same code can serve two callers: the
// autograder (a real submission graded against its problem's answer key) and the
// staff evaluator trial page (an ad-hoc pair of uploaded files). Everything that
// depends on a Submission row, activity logging and the similarity report, stays
// in the worker; this file only knows about paths, config and the jar's output.
//
// Must run in the worker container, which has the jar and no network egress. The
// web container also has the jar, which makes calling this from a route tempting
// and wrong.

import JavaRunner from '../../lib/java-runner';
import type { EvaluatorConfig } from './eval-config';
import { errMessage } from './errors';
import type { MoselSpec } from '@/schemas/mosel';
import type { RubricDefinition } from '@/schemas/rubric';

// The evaluator interface both the constructor and the fallback factory produce,
// declared once instead of being spelled out at each interop cast site.
type JavaEvaluator = {
  execute: (
    args: string[],
    options?: {
      timeout?: number;
      maxMemoryMb?: number;
      env?: Record<string, string>;
      input?: string;
    },
  ) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>;
};

function getJavaRunnerCtor(): new (jarPath: string) => JavaEvaluator {
  const maybeCtor =
    typeof JavaRunner === 'function'
      ? JavaRunner
      : (JavaRunner as unknown as { default?: unknown })?.default;

  if (typeof maybeCtor !== 'function') {
    throw new Error('Java runner constructor is unavailable');
  }

  return maybeCtor as new (jarPath: string) => JavaEvaluator;
}

function createJavaRunner(jarPath: string): JavaEvaluator {
  const JavaRunnerCtor = getJavaRunnerCtor();
  try {
    return new JavaRunnerCtor(jarPath);
  } catch {
    // Some builds export a plain factory rather than a constructor.
    return (JavaRunnerCtor as unknown as (path: string) => JavaEvaluator)(jarPath);
  }
}

/** The problem metadata the CLI args are derived from. */
export type EvaluatorProblemOptions = {
  /** Nullable because Problem.type is: a problem row can exist before it has one. */
  type: string | null;
  maxStates?: number | null;
  isDeterministic?: boolean | null;
};

/**
 * Problem-type-specific evaluator CLI args (after the fixed `--json answer upload`, where the
 * answer is a file or `--answer-from-mosel`):
 * FA/PDA pass a max-states bound, and FA additionally passes the determinism flag.
 */
export function buildEvaluatorArgs(problem: EvaluatorProblemOptions): string[] {
  if (problem.type !== 'FA' && problem.type !== 'PDA') return [];
  const args = [String(problem.maxStates ?? -1)];
  if (problem.type === 'FA') {
    args.push(String(problem.isDeterministic ?? false));
  }
  return args;
}

/**
 * What the evaluator is given on top of the two files, through `--grading-config`: the
 * problem's MOSEL description (FA only) and the rubric to score with. Either may be absent,
 * except that a run with no answer file needs the description, since it is the answer.
 */
export type GradingConfig = {
  mosel?: MoselSpec;
  // RUBRIC: the rubric travels to the jar here (see RUBRIC_LOCATIONS.md).
  rubric?: RubricDefinition;
};

/**
 * The grading config for a run, or null when there is nothing to send, in which case the jar
 * is invoked exactly as it always was.
 *
 * The description only goes with FA problems: it describes a language of strings, which the
 * evaluator can only check an automaton against. A description left on a problem whose type
 * was later changed is ignored rather than sent.
 */
export function buildGradingConfig(opts: {
  type: string | null;
  moselSpec?: unknown;
  rubricDefinition?: unknown;
}): GradingConfig | null {
  const config: GradingConfig = {};
  if (opts.type === 'FA' && opts.moselSpec != null) {
    config.mosel = opts.moselSpec as MoselSpec;
  }
  // RUBRIC: any stored definition is passed through; the jar validates it and falls back to
  // correct/incorrect (with an `errors` entry) if it cannot apply it.
  if (opts.rubricDefinition != null) {
    config.rubric = opts.rubricDefinition as RubricDefinition;
  }
  return config.mosel || config.rubric ? config : null;
}

/**
 * What the jar did, in the four shapes callers have to tell apart:
 *
 * - `ok`: stdout parsed to a JSON object, the only case with a verdict.
 * - `invalid-json`: parsed, but not to an object (`null`, a number, a bare string).
 * - `unparsable`: stdout was not JSON at all, including empty output.
 * - `error`: the process never produced usable output (throw, timeout, missing jar).
 *
 * `stdout`/`stderr` are trimmed, and empty on `error` because nothing was captured.
 */
export type EvaluatorRunResult = {
  stdout: string;
  stderr: string;
  /** Wall-clock time spent in the jar, for display and for spotting timeouts. */
  durationMs: number;
} & (
  | {
      outcome: 'ok';
      evaluation: Record<string, unknown>;
      correct?: boolean;
      feedback: string;
      /**
       * The rubric's score from 0 to 1, when the run had a rubric and the jar returned one.
       * RUBRIC: read back from the jar here.
       */
      score?: number;
    }
  | { outcome: 'invalid-json'; evaluation: unknown }
  | { outcome: 'unparsable'; parseError: string }
  | { outcome: 'error'; error: string }
);

/**
 * The evaluator writes its verdict to `feedback`, but some jar builds hand back a
 * Java Stream's `toString()` there, which is meaningless to a reader. Fall back to
 * a plain sentence in that case, and whenever `feedback` is not a string at all.
 */
function readFeedback(evaluation: Record<string, unknown>, correct?: boolean): string {
  const raw = evaluation.feedback;
  if (typeof raw === 'string' && !/java\.lang\..*Stream@/i.test(raw)) return raw;
  return `Evaluation completed - correct: ${correct}`;
}

/** The score, if it is one: a finite number from 0 to 1. Anything else is treated as absent. */
function readScore(evaluation: Record<string, unknown>): number | undefined {
  const raw = evaluation.score;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : undefined;
}

/**
 * Run the evaluator against an answer file and a submitted file, and classify what
 * came back. Never throws: every failure mode is one of the outcomes above, because
 * both callers have to record something rather than lose the run.
 *
 * With no answer file, the submission is marked against the MOSEL description in
 * `grading` instead (`--answer-from-mosel`): the jar builds the DFA it stands for and runs
 * the same equivalence check on it, so the student sees the same feedback either way.
 */
export async function runEvaluatorJar(params: {
  /** Null to mark against `grading.mosel`, which must then be present. */
  answerFilePath: string | null;
  uploadedFilePath: string;
  config: EvaluatorConfig;
  problem: EvaluatorProblemOptions;
  /** The MOSEL description and rubric, from {@link buildGradingConfig}. Null sends neither. */
  grading?: GradingConfig | null;
}): Promise<EvaluatorRunResult> {
  const { answerFilePath, uploadedFilePath, config, problem, grading } = params;
  const startedAt = Date.now();

  if (answerFilePath === null && !grading?.mosel) {
    return {
      outcome: 'error',
      error: 'No answer file and no language description to mark against.',
      stdout: '',
      stderr: '',
      durationMs: 0,
    };
  }

  let stdout = '';
  let stderr = '';
  try {
    const evaluator = createJavaRunner('./jars/afct-evaluator.jar');
    // The config goes over stdin ('-') rather than a file: nothing to write, clean up or leak.
    const gradingArgs = grading ? ['--grading-config', '-'] : [];
    const args = [
      '--json',
      ...gradingArgs,
      ...(answerFilePath === null ? ['--answer-from-mosel'] : [answerFilePath]),
      uploadedFilePath,
      ...buildEvaluatorArgs(problem),
    ];

    // Execute the evaluator with the configured timeout, memory cap, and analyzer
    // bound (overrides the CFGANALYZER_LIMIT env default). The jar also reads:
    //   - TIMEOUT_SECONDS: the time budget it uses to early-stop upgraded-feedback
    //     equivalence checks (without it the jar logs "early stopping disabled");
    //     derived from the same eval timeout, in whole seconds.
    //   - UPGRADED_FEEDBACK: the jar defaults this on when unset, but set it
    //     explicitly so the behavior is deterministic and the "not set" warning stops.
    const result = await evaluator.execute(args, {
      timeout: config.timeoutMs,
      maxMemoryMb: config.maxMemoryMb,
      env: {
        CFGANALYZER_LIMIT: String(config.analyzerLimit),
        TIMEOUT_SECONDS: String(Math.max(1, Math.floor(config.timeoutMs / 1000))),
        UPGRADED_FEEDBACK: 'true',
      },
      ...(grading ? { input: JSON.stringify(grading) } : {}),
    });

    stdout = result.stdout?.trim() ?? '';
    stderr = result.stderr?.trim() ?? '';
  } catch (evaluatorErr) {
    return {
      outcome: 'error',
      error: errMessage(evaluatorErr),
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
    };
  }

  const durationMs = Date.now() - startedAt;

  let evaluation: unknown;
  try {
    evaluation = JSON.parse(stdout);
  } catch (parseErr) {
    return { outcome: 'unparsable', parseError: errMessage(parseErr), stdout, stderr, durationMs };
  }

  if (!evaluation || typeof evaluation !== 'object') {
    return { outcome: 'invalid-json', evaluation, stdout, stderr, durationMs };
  }

  const record = evaluation as Record<string, unknown>;
  const correct = typeof record.correct === 'boolean' ? record.correct : undefined;
  const score = readScore(record);
  return {
    outcome: 'ok',
    evaluation: record,
    correct,
    feedback: readFeedback(record, correct),
    ...(score !== undefined ? { score } : {}),
    stdout,
    stderr,
    durationMs,
  };
}
