import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { withStaffAuth } from '@/lib/api/with-auth';
import { logError, logMutation } from '@/lib/api/activity';
import { findVisibleRubric, rubricSelect, serializeRubric } from '@/lib/rubrics';

// RUBRIC: copying a rubric into the caller's own library (see RUBRIC_LOCATIONS.md).

type Ctx = { params: Promise<{ rid: string }> };

/**
 * Copies a rubric into the caller's own library, where they can change it. Anybody who can see
 * the rubric: this is how course staff who do not own a rubric get one they can edit.
 * @openapi
 * summary: Duplicate a rubric
 * parameters:
 *   - { name: rid, in: path, required: true, schema: { type: string } }
 * responses:
 *   201: { description: The copy. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: "No such rubric, or the caller cannot see it." }
 *   500: { description: Server error. }
 */
export const POST = withStaffAuth<Ctx>(
  async (req, ctx, { user }) => {
    const { rid } = await ctx.params;
    try {
      const source = await findVisibleRubric(user, rid);
      if (!source) return apiError(404, 'Not found');

      const copy = await prisma.rubric.create({
        data: {
          name: `${source.name} (copy)`.slice(0, 100),
          description: source.description,
          // RUBRIC: the definition is copied as it is; nothing to translate while there is one kind.
          definition: source.definition as Prisma.InputJsonValue,
          ownerId: user.id,
        },
        select: rubricSelect,
      });

      await logMutation(req, {
        userId: user.id,
        action: 'RUBRIC_DUPLICATED',
        category: 'ASSIGNMENT',
        metadata: { rubricId: copy.id, rubricName: copy.name, sourceRubricId: rid },
      });

      return NextResponse.json(serializeRubric(copy, user), { status: 201 });
    } catch (error) {
      console.error('Error duplicating rubric:', error);
      await logError(req, {
        userId: user.id,
        action: 'RUBRIC_DUPLICATE_ERROR',
        category: 'ASSIGNMENT',
        error,
        metadata: { rubricId: rid },
      });
      return apiError(500, 'Internal server error');
    }
  },
  { deniedAction: 'RUBRIC_DUPLICATE_DENIED', deniedCategory: 'ASSIGNMENT' },
);
