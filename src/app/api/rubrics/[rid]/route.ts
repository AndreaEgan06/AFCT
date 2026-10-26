import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { readJson } from '@/lib/api/request';
import { withStaffAuth } from '@/lib/api/with-auth';
import { diffFields, logError, logMutation } from '@/lib/api/activity';
import {
  canEditRubric,
  findVisibleRubric,
  rubricSelect,
  rubricUsage,
  serializeRubric,
} from '@/lib/rubrics';
import { RubricUpdateApiSchema } from '@/schemas/rubric';

// RUBRIC: read, rename and delete one rubric (see RUBRIC_LOCATIONS.md).

type Ctx = { params: Promise<{ rid: string }> };

/**
 * One rubric, with where it is used. Its owner, a system admin, or staff of a course it is used
 * in. Only uses in courses the caller staffs are listed.
 * @openapi
 * summary: Read a rubric
 * parameters:
 *   - { name: rid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: "The rubric, with `usage`: the problems on assignments it grades." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: "No such rubric, or the caller cannot see it." }
 *   500: { description: Server error. }
 */
export const GET = withStaffAuth<Ctx>(
  async (_req, ctx, { user }) => {
    try {
      const { rid } = await ctx.params;
      const rubric = await findVisibleRubric(user, rid);
      if (!rubric) return apiError(404, 'Not found');

      const usage = await rubricUsage(user, rid);
      return NextResponse.json({
        ...serializeRubric(rubric, user),
        usage: usage.map((u) => ({
          course: u.assignment.course,
          assignment: { id: u.assignment.id, title: u.assignment.title },
          problem: u.problem,
        })),
      });
    } catch (error) {
      console.error('Error reading rubric:', error);
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_ACCESS_DENIED', deniedCategory: 'ASSIGNMENT' },
);

/**
 * Renames or re-describes a rubric. Its owner or a system admin.
 *
 * Nothing here changes how anything is graded: there is only one kind of rubric so far, and its
 * definition is not editable. When definitions become editable, an edit will not regrade work
 * already marked, because each submission keeps a copy of the rubric it was graded under.
 * @openapi
 * summary: Update a rubric
 * parameters:
 *   - { name: rid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           name: { type: string, maxLength: 100 }
 *           description: { type: string, maxLength: 2000, nullable: true }
 * responses:
 *   200: { description: The updated rubric. }
 *   400: { description: Invalid body. }
 *   401: { description: Not signed in. }
 *   403: { description: "The caller can see the rubric but does not own it." }
 *   404: { description: "No such rubric, or the caller cannot see it." }
 *   500: { description: Server error. }
 */
export const PATCH = withStaffAuth<Ctx>(
  async (req, ctx, { user }) => {
    const { rid } = await ctx.params;
    try {
      const existing = await findVisibleRubric(user, rid);
      if (!existing) return apiError(404, 'Not found');
      if (!canEditRubric(user, existing)) {
        return apiError(
          403,
          'Only the owner of a rubric can change it. Duplicate it to get your own copy.',
        );
      }

      const parsed = await readJson(req, RubricUpdateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { name, description } = parsed.data;

      const updated = await prisma.rubric.update({
        where: { id: rid },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description: description || null } : {}),
        },
        select: rubricSelect,
      });

      await logMutation(req, {
        userId: user.id,
        action: 'RUBRIC_UPDATED',
        category: 'ASSIGNMENT',
        metadata: {
          rubricId: rid,
          rubricName: updated.name,
          changes: diffFields(existing, updated, ['name', 'description']),
        },
      });

      return NextResponse.json(serializeRubric(updated, user));
    } catch (error) {
      console.error('Error updating rubric:', error);
      await logError(req, {
        userId: user.id,
        action: 'RUBRIC_UPDATE_ERROR',
        category: 'ASSIGNMENT',
        error,
        metadata: { rubricId: rid },
      });
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_UPDATE_DENIED', deniedCategory: 'ASSIGNMENT' },
);

/**
 * Deletes a rubric. Its owner or a system admin, and only while nothing uses it: detach it from
 * every problem first. Refusing is what keeps a deletion from quietly changing how work is
 * graded, the same rule the problem bank applies to a problem in use.
 * @openapi
 * summary: Delete a rubric
 * parameters:
 *   - { name: rid, in: path, required: true, schema: { type: string } }
 * responses:
 *   204: { description: Deleted. }
 *   401: { description: Not signed in. }
 *   403: { description: "The caller can see the rubric but does not own it." }
 *   404: { description: "No such rubric, or the caller cannot see it." }
 *   409: { description: The rubric is still attached to at least one problem. }
 *   500: { description: Server error. }
 */
export const DELETE = withStaffAuth<Ctx>(
  async (req, ctx, { user }) => {
    const { rid } = await ctx.params;
    try {
      const existing = await findVisibleRubric(user, rid);
      if (!existing) return apiError(404, 'Not found');
      if (!canEditRubric(user, existing)) {
        return apiError(403, 'Only the owner of a rubric can delete it.');
      }

      // Checked and deleted in one statement, so a link added in between cannot be orphaned:
      // the delete only matches a rubric that is still unused.
      const deleted = await prisma.rubric.deleteMany({
        where: { id: rid, assignmentProblems: { none: {} } },
      });
      if (deleted.count === 0) {
        return apiError(
          409,
          'This rubric is still used by at least one problem. Remove it from those problems first.',
        );
      }

      await logMutation(req, {
        userId: user.id,
        action: 'RUBRIC_DELETED',
        category: 'ASSIGNMENT',
        metadata: { rubricId: rid, rubricName: existing.name },
      });

      return new NextResponse(null, { status: 204 });
    } catch (error) {
      console.error('Error deleting rubric:', error);
      await logError(req, {
        userId: user.id,
        action: 'RUBRIC_DELETE_ERROR',
        category: 'ASSIGNMENT',
        error,
        metadata: { rubricId: rid },
      });
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_DELETE_DENIED', deniedCategory: 'ASSIGNMENT' },
);
