import { NextResponse } from 'next/server';
import fs from 'fs';
import type { ProblemType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withStaffAuth } from '@/lib/api/with-auth';
import { readFormData } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { safeStoredFilename, resolveInsideDir, safeUnlinkInDir } from '@/lib/safe-upload';
import { ALLOWED_PROBLEM_EXTENSIONS, isAllowedProblemExtension } from '@/schemas/problem';
import { EvaluatorTrialCreateApiSchema } from '@/schemas/evaluator-trial';
import { TRIALS_DIR, trialExpiresAt, pruneExpiredTrials } from '@/lib/evaluator-trials';
import { serializeTrial } from '@/lib/evaluator-trial-view';
import { findVisibleRubric } from '@/lib/rubrics';
import { missingAnswerKey } from '@/lib/answer-file';
import type { Prisma } from '@prisma/client';

/**
 * Starts an evaluator trial: an answer file and a submitted file, queued to be run
 * through the real evaluator. Course staff (faculty or TAs) or a system admin. An FA
 * trial may give a MOSEL description instead of the answer file, and is then marked
 * against it, as a problem with no answer file would be.
 *
 * Nothing here is graded and nothing is kept: the uploads are deleted as soon as the run
 * finishes and the result expires within the hour. A caller may only have one trial in
 * flight at a time, which is also what stops the queue filling with them.
 * @openapi
 * summary: Start an evaluator trial
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [type, submissionFile]
 *         properties:
 *           type: { type: string, description: "Problem type (FA, PDA, RE, CFG, TM)" }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           moselSpec: { type: string, description: "FA only: a MOSEL description (JSON). Without an answer file the submission is marked against it; with one it is analysed against it." }
 *           rubricId: { type: string, description: "Optional: a rubric to score the run with." }
 *           answerFile: { type: string, format: binary, description: "Required unless an FA trial gives moselSpec." }
 *           submissionFile: { type: string, format: binary }
 * responses:
 *   201: { description: The queued trial. }
 *   400: { description: "Missing files, a file failed structure validation, or an unknown rubric." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   409: { description: The caller already has a trial in flight. }
 *   413: { description: A file exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export const POST = withStaffAuth(
  async (req, _ctx, { user }) => {
    const written: string[] = [];
    try {
      const parsed = await readFormData(req, EvaluatorTrialCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { type, maxStates, isDeterministic, moselSpec, rubricId } = parsed.data;

      // RUBRIC: the definition is copied onto the trial, so the run uses the rubric as it was
      // when it was asked for, like a submission does.
      let rubricDefinition: Prisma.InputJsonValue | undefined;
      if (rubricId) {
        const rubric = await findVisibleRubric(user, rubricId);
        if (!rubric) return apiError(400, 'Rubric not found.');
        rubricDefinition = rubric.definition as Prisma.InputJsonValue;
      }

      const uploadedAnswer = parsed.form.get('answerFile') as File | null;
      const answerFile = uploadedAnswer?.size ? uploadedAnswer : null;
      const submissionFile = parsed.form.get('submissionFile') as File | null;
      if (!submissionFile?.size) {
        return apiError(400, 'A submission file is required.');
      }
      const missing = missingAnswerKey({
        type,
        hasAnswerFile: answerFile !== null,
        hasMoselSpec: type === 'FA' && moselSpec != null,
      });
      if (missing) return apiError(400, missing);

      for (const file of [answerFile, submissionFile]) {
        if (!file) continue;
        if (!isAllowedProblemExtension(file.name)) {
          return apiError(400, `Allowed file types: .${ALLOWED_PROBLEM_EXTENSIONS.join(', .')}`);
        }
      }

      const { maxBytes, maxMb } = await getSystemUploadLimit();
      if ((answerFile?.size ?? 0) > maxBytes || submissionFile.size > maxBytes) {
        return apiError(413, `File exceeds max upload size (${maxMb} MB).`);
      }

      // One trial per person at a time. Checked before anything is written so a caller
      // who is already waiting does not leave a second pair of files behind.
      const inFlight = await prisma.evaluatorTrial.findFirst({
        where: { requestedById: user.id, state: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true },
      });
      if (inFlight) {
        return apiError(409, 'You already have a trial running. Wait for it to finish.');
      }

      // Same structure check a real upload gets, which is also what keeps the evaluator
      // away from hostile XML (see xmlStructureValidate).
      const uploads: { label: 'answer' | 'submission'; file: File; buffer: Buffer }[] = [];
      for (const [label, file] of [
        ['answer', answerFile],
        ['submission', submissionFile],
      ] as const) {
        if (!file) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
        const validation = validateStructureXML(buffer.toString('utf8'), type);
        if (!validation.isValid) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'EVALUATOR_TRIAL_INVALID_FILE',
            severity: 'WARNING',
            category: 'SYSTEM',
            metadata: { which: label, fileName: file.name, problemType: type, error: validation.error },
          });
          return apiError(400, `The ${label} file could not be read: ${validation.error}`);
        }
        uploads.push({ label, file, buffer });
      }

      await fs.promises.mkdir(TRIALS_DIR, { recursive: true });
      const storedNames: Partial<Record<'answer' | 'submission', string>> = {};
      for (const { label, file, buffer } of uploads) {
        const name = safeStoredFilename(file.name);
        await fs.promises.writeFile(resolveInsideDir(TRIALS_DIR, name), buffer, { mode: 0o644 });
        storedNames[label] = name;
        written.push(name);
      }

      const trial = await prisma.evaluatorTrial.create({
        data: {
          requestedById: user.id,
          problemType: type as ProblemType,
          maxStates: type === 'FA' || type === 'PDA' ? (maxStates ?? null) : null,
          isDeterministic: type === 'FA' ? (isDeterministic ?? false) : null,
          ...(type === 'FA' && moselSpec ? { moselSpec } : {}),
          ...(rubricDefinition ? { rubricDefinition } : {}),
          answerFileName: storedNames.answer ?? null,
          submissionFileName: storedNames.submission ?? null,
          // None when the trial is marked against its description.
          answerOriginalName: answerFile?.name ?? null,
          submissionOriginalName: submissionFile.name,
          expiresAt: trialExpiresAt(),
        },
      });

      // Categorised SYSTEM rather than SUBMISSION on purpose: nothing here is a
      // submission, and the study reads SUBMISSION events as student activity. The file
      // names go in because they are the only record of what was run, the uploads
      // themselves being deleted minutes later.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'EVALUATOR_TRIAL_STARTED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: {
          trialId: trial.id,
          problemType: type,
          maxStates: trial.maxStates,
          isDeterministic: trial.isDeterministic,
          hasMoselSpec: trial.moselSpec != null,
          rubricId: rubricId ?? null,
          answerFileName: answerFile?.name ?? null,
          submissionFileName: submissionFile.name,
        },
      });

      // Cheap moment to take out the rubbish: this is the only route that runs often
      // enough to matter and rarely enough not to.
      void pruneExpiredTrials().catch(() => {});

      return NextResponse.json(serializeTrial(trial), { status: 201 });
    } catch (error) {
      // Files with no row behind them would never be read and never be removed by the
      // usual path, so take them back out on the way past.
      for (const name of written) await safeUnlinkInDir(TRIALS_DIR, name);
      console.error('Error starting evaluator trial:', error);
      await logError(req, {
        userId: user.id,
        action: 'EVALUATOR_TRIAL_ERROR',
        category: 'SYSTEM',
        error,
      });
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'EVALUATOR_TRIAL_ACCESS_DENIED' },
);
