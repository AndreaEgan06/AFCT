import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { readJson } from '@/lib/api/request';
import { withStaffAuth } from '@/lib/api/with-auth';
import { logError, logMutation } from '@/lib/api/activity';
import { canManageCourse } from '@/lib/permissions';
import { rubricSelect, serializeRubric, visibleRubricsWhere } from '@/lib/rubrics';
import { BINARY_RUBRIC_DEFINITION, RubricCreateApiSchema } from '@/schemas/rubric';

// RUBRIC: the rubric library's list and create routes (see RUBRIC_LOCATIONS.md).

/**
 * The rubrics the caller can use. Course staff (faculty or TAs) or a system admin.
 *
 * Without `courseId`: their own library, plus any rubric in use in a course they staff (which
 * they can see but not change). With `courseId`: what can be attached to a problem in that
 * course, which is their own rubrics plus those already in use there.
 * @openapi
 * summary: List rubrics
 * parameters:
 *   - { name: courseId, in: query, required: false, schema: { type: string }, description: "Only rubrics that can be attached in this course." }
 * responses:
 *   200: { description: "The rubrics, newest first, as { rubrics: [...] }." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: "The course does not exist or the caller does not manage it." }
 *   500: { description: Server error. }
 */
export const GET = withStaffAuth(
  async (req, _ctx, { user }) => {
    try {
      const courseId = new URL(req.url).searchParams.get('courseId') ?? undefined;
      if (courseId && !(await canManageCourse(user, courseId))) {
        return apiError(404, 'Course not found');
      }
      const rubrics = await prisma.rubric.findMany({
        where: visibleRubricsWhere(user, { courseId }),
        select: rubricSelect,
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ rubrics: rubrics.map((r) => serializeRubric(r, user)) });
    } catch (error) {
      console.error('Error listing rubrics:', error);
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_ACCESS_DENIED', deniedCategory: 'ASSIGNMENT' },
);

/**
 * Creates a rubric in the caller's own library. Course staff (faculty or TAs) or a system admin.
 *
 * Only a name and description are taken. What a rubric does is not decided yet, so every rubric
 * gets the one definition there is, `{ "version": 1, "kind": "binary" }`, which grades exactly
 * like having no rubric.
 * @openapi
 * summary: Create a rubric
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name]
 *         properties:
 *           name: { type: string, maxLength: 100 }
 *           description: { type: string, maxLength: 2000, nullable: true }
 * responses:
 *   201: { description: The new rubric. }
 *   400: { description: Invalid body. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withStaffAuth(
  async (req, _ctx, { user }) => {
    try {
      const parsed = await readJson(req, RubricCreateApiSchema);
      if (!parsed.ok) return parsed.response;

      const rubric = await prisma.rubric.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          // RUBRIC: binary-only; take the definition from the body once there are real kinds.
          definition: BINARY_RUBRIC_DEFINITION,
          ownerId: user.id,
        },
        select: rubricSelect,
      });

      await logMutation(req, {
        userId: user.id,
        action: 'RUBRIC_CREATED',
        category: 'ASSIGNMENT',
        metadata: { rubricId: rubric.id, rubricName: rubric.name },
      });

      return NextResponse.json(serializeRubric(rubric, user), { status: 201 });
    } catch (error) {
      console.error('Error creating rubric:', error);
      await logError(req, {
        userId: user.id,
        action: 'RUBRIC_CREATE_ERROR',
        category: 'ASSIGNMENT',
        error,
      });
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_CREATE_DENIED', deniedCategory: 'ASSIGNMENT' },
);
