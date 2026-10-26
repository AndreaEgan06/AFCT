import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import type { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { withCourseAuth } from '@/lib/api/with-auth';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { submissionContentHash, submissionShapeHash } from '@/lib/similarity/content-hash';
import { readFormData } from '@/lib/api/request';
import { descriptionWriteData } from '@/lib/description-write';
import { missingAnswerKey } from '@/lib/answer-file';
import {
  ProblemCreateApiSchema,
  ALLOWED_PROBLEM_EXTENSIONS,
  isAllowedProblemExtension,
} from '@/schemas/problem';

// Solution files are written here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Lists a course's problem bank (id, title, description, type), for pickers such as the
 * "import a problem from another course" wizard. Course staff (faculty or TAs) or a
 * system admin; this route is manage-gated, so no student reaches it.
 * @openapi
 * summary: List a course's problems
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's problems.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { courseId }) => {
    try {
      const problems = await prisma.problem.findMany({
        where: { courseId },
        select: { id: true, title: true, description: true, type: true },
        orderBy: { title: 'asc' },
      });
      return NextResponse.json(problems);
    } catch (error) {
      console.error('Error listing problems:', error);
      return NextResponse.json({ error: 'Failed to fetch problems.' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_PROBLEMS_ACCESS_DENIED' },
);

/**
 * Creates a problem in a course from an uploaded solution file (multipart/form-data).
 * Course staff (faculty or TAs) or a system admin. The file's XML structure is
 * validated against the problem type before it's written to disk, and it's
 * size-checked against the system upload limit. `maxStates` applies to FA/PDA and
 * `isDeterministic` to FA. An FA problem may give a MOSEL description instead of the
 * file (or as well); submissions are then marked against the description. The course
 * comes from the path.
 * @openapi
 * summary: Create a problem in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [title, type]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           type: { type: string, description: "Problem type (e.g. FA, PDA, RE, CFG)" }
 *           assignmentId: { type: string }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           moselSpec: { type: string, description: "FA only: the target language as a MOSEL description (JSON). Without a file, submissions are marked against it; with one, the file decides and the description is analysed against submissions." }
 *           file: { type: string, format: binary, description: "Solution definition (XML). Required unless an FA problem gives moselSpec." }
 * responses:
 *   201: { description: The created problem. }
 *   400: { description: "Missing fields, no answer key, or the solution file failed structure validation." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Course not found. }
 *   413: { description: File exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      // Validate the scalar fields server-side (title, type, coerced numbers/bools).
      const parsed = await readFormData(req, ProblemCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;
      const { title, type } = data;
      const uploaded = parsed.form.get('file') as File | null;
      const file = uploaded && uploaded.size > 0 ? uploaded : null;
      const moselSpec = type === 'FA' ? (data.moselSpec ?? null) : null;

      const missing = missingAnswerKey({
        type,
        hasAnswerFile: file !== null,
        hasMoselSpec: moselSpec !== null,
      });
      if (missing) {
        return NextResponse.json({ error: missing }, { status: 400 });
      }

      // Ensure the course exists before writing anything.
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // A problem defined by its description alone has no file to check or store.
      const stored = file ? await storeAnswerFile(file, type) : null;
      if (stored && !stored.ok) {
        if (stored.invalidStructure) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'PROBLEM_INVALID_FILE_STRUCTURE',
            severity: 'WARNING',
            category: 'PROBLEM',
            courseId,
            metadata: {
              userId: user.id,
              courseId,
              error: stored.error,
            },
          });
        }
        return NextResponse.json({ error: stored.error }, { status: stored.status });
      }
      const fileName = stored?.fileName ?? null;
      const fullPath = stored?.fullPath ?? null;

      // Create the problem record in the database
      let problem;
      try {
        problem = await prisma.problem.create({
          data: {
            title,
            ...descriptionWriteData(data),
            type: type as ProblemType,
            courseId,
            fileName,
            originalFileName: file?.name ?? null,
            // The same fingerprints a submission gets, so the Similarity tab can tell a
            // reader when matching work is simply the answer they posted.
            answerContentHash: stored?.contentHash ?? null,
            answerShapeHash: stored?.shapeHash ?? null,
            maxStates: ['FA', 'PDA'].includes(type) ? (data.maxStates ?? 0) || null : null,
            isDeterministic: type === 'FA' ? (data.isDeterministic ?? false) : null,
            ...(moselSpec ? { moselSpec } : {}),
          },
        });
      } catch (dbErr) {
        // No row references this file, so remove it instead of leaving it orphaned in
        // the uploads volume forever.
        if (fullPath) {
          try {
            await fs.promises.unlink(fullPath);
          } catch {
            // Best effort: a stray file is preferable to masking the real error.
          }
        }
        throw dbErr;
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: problem.id,
        metadata: {
          userId: user.id,
          courseId,
          problemId: problem.id,
          problemTitle: problem.title,
          problemType: type,
          fileName,
          hasMoselSpec: problem.moselSpec != null,
        },
      });

      return NextResponse.json(problem, { status: 201 });
    } catch (error) {
      console.error('Error creating problem:', error);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_CREATE_ERROR',
        category: 'PROBLEM',
        courseId,
        error,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_CREATE_DENIED', blockWhenArchived: true },
);

type StoredAnswerFile =
  | {
      ok: true;
      fileName: string;
      fullPath: string;
      contentHash: string | null;
      shapeHash: string | null;
    }
  | { ok: false; status: 400 | 413; error: string; invalidStructure: boolean };

/**
 * Checks an uploaded answer file (extension, size, structure for the problem type) and writes
 * it to the uploads volume, or says why it was refused.
 */
async function storeAnswerFile(file: File, type: string): Promise<StoredAnswerFile> {
  // Enforce the solution-file extension allow-list server-side (previously only
  // the browser checked this).
  if (!isAllowedProblemExtension(file.name)) {
    return {
      ok: false,
      status: 400,
      error: `Allowed file types: .${ALLOWED_PROBLEM_EXTENSIONS.join(', .')}`,
      invalidStructure: false,
    };
  }

  const { maxBytes, maxMb } = await getSystemUploadLimit();
  if (file.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `File exceeds max upload size (${maxMb} MB).`,
      invalidStructure: false,
    };
  }

  // Pull the bytes across once and reuse them for both validation and the write.
  // This used to be file.text() here and file.arrayBuffer() again below, which
  // buffered the whole upload twice.
  const buffer = Buffer.from(await file.arrayBuffer());
  const xml = buffer.toString('utf8');
  const validation = validateStructureXML(xml, type);
  if (!validation.isValid) {
    return { ok: false, status: 400, error: validation.error, invalidStructure: true };
  }

  // Write uploaded file to disk under a random UUID + sanitized extension:
  // never a path derived from the client-supplied file.name. Written
  // non-executable; the original name is kept only as display metadata.
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const fileName = safeStoredFilename(file.name);
  const fullPath = resolveInsideDir(uploadsDir, fileName);
  await fs.promises.writeFile(fullPath, buffer, { mode: 0o644 });
  return {
    ok: true,
    fileName,
    fullPath,
    contentHash: submissionContentHash(buffer),
    shapeHash: submissionShapeHash(buffer),
  };
}
