import { beforeEach, describe, expect, it, vi } from 'vitest';

// RUBRIC: the rubric library's list and create routes.

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  rubric: { findMany: vi.fn(), create: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Correct or incorrect',
  description: null,
  definition: { version: 1, kind: 'binary' },
  ownerId: 'fac-1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  owner: { id: 'fac-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  _count: { assignmentProblems: 2 },
  ...over,
});

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/rubrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {},
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'fac-1', isAdmin: false } });
  // Staff somewhere, and on the course the tests ask about.
  prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'FACULTY' });
  prismaMock.course.findUnique.mockResolvedValue({ deletedAt: null });
  prismaMock.rubric.findMany.mockResolvedValue([row()]);
  prismaMock.rubric.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row({ ...data, id: 'r2', _count: { assignmentProblems: 0 } }),
  );
});

describe('GET /api/rubrics', () => {
  it('lists what the caller can see, with who owns it and whether they may edit it', async () => {
    const res = await GET(new Request('http://localhost/api/rubrics'), {});

    expect(res.status).toBe(200);
    const { rubrics } = await res.json();
    expect(rubrics).toEqual([
      expect.objectContaining({
        id: 'r1',
        owner: { id: 'fac-1', name: 'Ada Lovelace' },
        usageCount: 2,
        canEdit: true,
      }),
    ]);
    // Their own, or in use in a course they staff.
    const where = prismaMock.rubric.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { ownerId: 'fac-1' },
      expect.objectContaining({ assignmentProblems: expect.anything() }),
    ]);
  });

  it('marks somebody else’s rubric as not editable', async () => {
    prismaMock.rubric.findMany.mockResolvedValue([row({ ownerId: 'fac-2' })]);

    const { rubrics } = await (await GET(new Request('http://localhost/api/rubrics'), {})).json();

    expect(rubrics[0].canEdit).toBe(false);
  });

  it('narrows to what can be attached in a course', async () => {
    await GET(new Request('http://localhost/api/rubrics?courseId=c1'), {});

    const where = prismaMock.rubric.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { ownerId: 'fac-1' },
      { assignmentProblems: { some: { assignment: { courseId: 'c1' } } } },
    ]);
  });

  it('404s a course the caller does not manage', async () => {
    // Staff somewhere (the wrapper's check), but not on this course.
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({ id: 'roster-1' })
      .mockResolvedValueOnce(null);

    const res = await GET(new Request('http://localhost/api/rubrics?courseId=other'), {});

    expect(res.status).toBe(404);
    expect(prismaMock.rubric.findMany).not.toHaveBeenCalled();
  });

  it('keeps students out', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/rubrics'), {});

    expect(res.status).toBe(403);
  });
});

describe('POST /api/rubrics', () => {
  it('creates a binary rubric owned by the caller, whatever else is sent', async () => {
    const res = await post({ name: '  Homework rubric  ', description: 'For HW' });

    expect(res.status).toBe(201);
    expect(prismaMock.rubric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Homework rubric',
          description: 'For HW',
          definition: { version: 1, kind: 'binary' },
          ownerId: 'fac-1',
        },
      }),
    );
    expect(activityLogMock.mock.calls.map((c) => c[2].action)).toContain('RUBRIC_CREATED');
  });

  it('refuses a definition in the body: there is only one kind, and the server picks it', async () => {
    const res = await post({ name: 'X', definition: { version: 1, kind: 'perState' } });

    expect(res.status).toBe(400);
    expect(prismaMock.rubric.create).not.toHaveBeenCalled();
  });

  it('requires a name', async () => {
    expect((await post({ name: '   ' })).status).toBe(400);
  });
});
