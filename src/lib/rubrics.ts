// src/lib/rubrics.ts
//
// RUBRIC: who may see, change and attach a rubric, and where one is used (see
// RUBRIC_LOCATIONS.md).
//
// A rubric is in an instructor's own library rather than in a course, so the usual
// course gate cannot answer these questions on its own. The rules:
//
//   - its owner, and a system admin, may do anything with it;
//   - course staff may see a rubric that is attached to a problem in a course they staff,
//     and may attach it to other problems in that same course (it is already in use there,
//     so this shares nothing new), but may not change or delete it: they duplicate it to get
//     their own copy;
//   - nobody else can tell it exists.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { COURSE_STAFF_ROLES, isAdmin, type PermissionUser } from '@/lib/permissions';

/** The fields a rubric is shown with, everywhere. */
export const rubricSelect = {
  id: true,
  name: true,
  description: true,
  definition: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true, email: true } },
  _count: { select: { assignmentProblems: true } },
} satisfies Prisma.RubricSelect;

export type RubricRow = Prisma.RubricGetPayload<{ select: typeof rubricSelect }>;

/** A rubric as the API returns it. */
export type RubricView = {
  id: string;
  name: string;
  description: string | null;
  definition: unknown;
  owner: { id: string; name: string };
  /** How many problem-on-assignment links use it. Deleting is refused while this is above 0. */
  usageCount: number;
  /** Whether the caller may rename, edit or delete it (owner or admin). */
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
};

export function serializeRubric(rubric: RubricRow, user: PermissionUser): RubricView {
  return {
    id: rubric.id,
    name: rubric.name,
    description: rubric.description,
    definition: rubric.definition,
    owner: {
      id: rubric.owner.id,
      name:
        `${rubric.owner.firstName ?? ''} ${rubric.owner.lastName ?? ''}`.trim() ||
        rubric.owner.email,
    },
    usageCount: rubric._count.assignmentProblems,
    canEdit: canEditRubric(user, rubric),
    createdAt: rubric.createdAt.toISOString(),
    updatedAt: rubric.updatedAt.toISOString(),
  };
}

/** Owner or admin: may rename, edit and delete. */
export function canEditRubric(user: PermissionUser, rubric: { ownerId: string }): boolean {
  return isAdmin(user) || (!!user?.id && user.id === rubric.ownerId);
}

/** Rubrics attached to at least one problem in a course `userId` is staff on. */
function attachedInStaffedCourse(userId: string): Prisma.RubricWhereInput {
  return {
    assignmentProblems: {
      some: {
        assignment: {
          course: {
            deletedAt: null,
            roster: { some: { userId, role: { in: COURSE_STAFF_ROLES } } },
          },
        },
      },
    },
  };
}

/** Rubrics attached to at least one problem in this course. */
function attachedInCourse(courseId: string): Prisma.RubricWhereInput {
  return { assignmentProblems: { some: { assignment: { courseId } } } };
}

/**
 * The rubrics the caller can see: their own, plus those in use in a course they staff. With a
 * `courseId`, narrowed to what can be attached in that course: their own plus those already in
 * use there. An admin sees everything, or everything usable in the course.
 */
export function visibleRubricsWhere(
  user: PermissionUser,
  opts: { courseId?: string } = {},
): Prisma.RubricWhereInput {
  const userId = user?.id ?? '';
  if (opts.courseId) {
    if (isAdmin(user)) return {};
    return { OR: [{ ownerId: userId }, attachedInCourse(opts.courseId)] };
  }
  if (isAdmin(user)) return {};
  return { OR: [{ ownerId: userId }, attachedInStaffedCourse(userId)] };
}

/** One rubric, if the caller can see it; otherwise null, which routes report as 404. */
export async function findVisibleRubric(
  user: PermissionUser,
  rubricId: string,
): Promise<RubricRow | null> {
  return prisma.rubric.findFirst({
    where: { AND: [{ id: rubricId }, visibleRubricsWhere(user)] },
    select: rubricSelect,
  });
}

/**
 * Whether the caller may attach this rubric to a problem in this course. The course gate has
 * already established that they manage the course; this adds that the rubric is theirs, or is
 * already used in the course, or that they are an admin.
 */
export async function canAttachRubric(
  user: PermissionUser,
  rubricId: string,
  courseId: string,
): Promise<boolean> {
  const found = await prisma.rubric.findFirst({
    where: { AND: [{ id: rubricId }, visibleRubricsWhere(user, { courseId })] },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Where a rubric is used, for the Rubrics page. Only the links in courses the caller staffs are
 * listed (all of them for an admin): knowing that a rubric is used is fine, but which courses
 * and assignments another instructor teaches is not this person's business.
 */
export async function rubricUsage(user: PermissionUser, rubricId: string) {
  const userId = user?.id ?? '';
  return prisma.assignmentProblem.findMany({
    where: {
      rubricId,
      ...(isAdmin(user)
        ? {}
        : {
            assignment: {
              course: { roster: { some: { userId, role: { in: COURSE_STAFF_ROLES } } } },
            },
          }),
    },
    select: {
      assignment: {
        select: {
          id: true,
          title: true,
          course: { select: { id: true, name: true, code: true } },
        },
      },
      problem: { select: { id: true, title: true } },
    },
    orderBy: [{ assignment: { course: { name: 'asc' } } }, { assignment: { title: 'asc' } }],
  });
}
