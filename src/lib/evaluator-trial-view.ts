// The shape of an evaluator trial as the page sees it, in one place so the create and
// status routes cannot drift apart.
//
// Note what is missing: the stored file names. Those are internal to the uploads volume
// and are no use to a reader, who wants the names they picked the files by.

import type { EvaluatorTrial } from '@prisma/client';

export type EvaluatorTrialView = {
  id: string;
  state: EvaluatorTrial['state'];
  problemType: EvaluatorTrial['problemType'];
  maxStates: number | null;
  isDeterministic: boolean | null;
  /**
   * The MOSEL description, if one was given: what the submitted file was marked against when
   * there was no answer file, and analysed against either way.
   */
  moselSpec: unknown;
  /** RUBRIC: the rubric definition the run was scored with, if one was given. */
  rubricDefinition: unknown;
  /**
   * The names the uploader chose, kept for display after the files are deleted. No answer
   * file means the run was marked against the description.
   */
  answerFile: string | null;
  submissionFile: string;
  correct: boolean | null;
  /** RUBRIC: the rubric's score, 0 to 1, when the run had a rubric. */
  score: number | null;
  feedback: string | null;
  evaluationRaw: unknown;
  stderr: string | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
};

/** True once the run is over, either way. */
export function isTrialFinished(state: EvaluatorTrial['state']): boolean {
  return state === 'COMPLETED' || state === 'FAILED';
}

export function serializeTrial(trial: EvaluatorTrial): EvaluatorTrialView {
  return {
    id: trial.id,
    state: trial.state,
    problemType: trial.problemType,
    maxStates: trial.maxStates,
    isDeterministic: trial.isDeterministic,
    moselSpec: trial.moselSpec ?? null,
    rubricDefinition: trial.rubricDefinition ?? null,
    answerFile: trial.answerOriginalName,
    submissionFile: trial.submissionOriginalName,
    correct: trial.correct,
    score: trial.score,
    feedback: trial.feedback,
    evaluationRaw: trial.evaluationRaw ?? null,
    stderr: trial.stderr,
    durationMs: trial.durationMs,
    createdAt: trial.createdAt.toISOString(),
    startedAt: trial.startedAt?.toISOString() ?? null,
    completedAt: trial.completedAt?.toISOString() ?? null,
    expiresAt: trial.expiresAt.toISOString(),
  };
}
