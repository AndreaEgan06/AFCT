import { beforeEach, describe, expect, it, vi } from 'vitest';

// RUBRIC: read, rename, delete and duplicate one rubric.

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  rubric: { findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { DELETE, GET, PATCH } from './route';
import { POST as DUPLICATE } from './duplicate/route';

const ctx = { params: Promise.resolve({ rid: 'r1' }) };
const url = 'http://localhost/api/rubrics/r1';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Correct or incorrect',
  description: 'Binary',
  definition: { version: 1, kind: 'binary' },
  ownerId: 'fac-1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  owner: { id: 'fac-1', firstName: null, lastName: null, email: 'ada@example.com' },
  _count: { assignmentProblems: 0 },
  ...over,
});

const actions = () => activityLogMock.mock.calls.map((c) => c[2].action);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'fac-1', isAdmin: false } });
  prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1' });
  prismaMock.rubric.findFirst.mockResolvedValue(row());
  prismaMock.rubric.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row(data),
  );
  prismaMock.rubric.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.rubric.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row({ ...data, id: 'r2' }),
  );
  prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
});

describe('GET /api/rubrics/[rid]', () => {
  it('returns the rubric and where it is used', async () => {
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        assignment: { id: 'a1', title: 'HW 1', course: { id: 'c1', name: 'Theory', code: 'CS 1' } },
        problem: { id: 'p1', title: 'Ends in ab' },
      },
    ]);

    const res = await GET(new Request(url), ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'r1', owner: { name: 'ada@example.com' }, canEdit: true });
    expect(body.usage).toEqual([
      {
        course: { id: 'c1', name: 'Theory', code: 'CS 1' },
        assignment: { id: 'a1', title: 'HW 1' },
        problem: { id: 'p1', title: 'Ends in ab' },
      },
    ]);
  });

  it('404s a rubric the caller cannot see', async () => {
    prismaMock.rubric.findFirst.mockResolvedValue(null);

    expect((await GET(new Request(url), ctx)).status).toBe(404);
  });
});

describe('PATCH /api/rubrics/[rid]', () => {
  const patch = (body: unknown) =>
    PATCH(
      new Request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      ctx,
    );

  it('renames the owner’s rubric', async () => {
    const res = await patch({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(prismaMock.rubric.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: { name: 'Renamed' } }),
    );
    expect(actions()).toContain('RUBRIC_UPDATED');
  });

  it('refuses staff who can see it but do not own it', async () => {
    prismaMock.rubric.findFirst.mockResolvedValue(row({ ownerId: 'fac-2' }));

    const res = await patch({ name: 'Mine now' });

    expect(res.status).toBe(403);
    expect(prismaMock.rubric.update).not.toHaveBeenCalled();
  });

  it('lets an admin change anybody’s', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.rubric.findFirst.mockResolvedValue(row({ ownerId: 'fac-2' }));

    expect((await patch({ description: '' })).status).toBe(200);
    expect(prismaMock.rubric.update.mock.calls[0]![0].data).toEqual({ description: null });
  });
});

describe('DELETE /api/rubrics/[rid]', () => {
  const del = () => DELETE(new Request(url, { method: 'DELETE' }), ctx);

  it('deletes an unused rubric, checking it is unused in the same statement', async () => {
    const res = await del();

    expect(res.status).toBe(204);
    expect(prismaMock.rubric.deleteMany).toHaveBeenCalledWith({
      where: { id: 'r1', assignmentProblems: { none: {} } },
    });
    expect(actions()).toContain('RUBRIC_DELETED');
  });

  it('refuses while anything uses it', async () => {
    prismaMock.rubric.deleteMany.mockResolvedValue({ count: 0 });

    const res = await del();

    expect(res.status).toBe(409);
    expect(actions()).not.toContain('RUBRIC_DELETED');
  });

  it('refuses somebody who does not own it', async () => {
    prismaMock.rubric.findFirst.mockResolvedValue(row({ ownerId: 'fac-2' }));

    expect((await del()).status).toBe(403);
    expect(prismaMock.rubric.deleteMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/rubrics/[rid]/duplicate', () => {
  it('copies a rubric the caller can see into their own library', async () => {
    prismaMock.rubric.findFirst.mockResolvedValue(row({ ownerId: 'fac-2' }));

    const res = await DUPLICATE(new Request(`${url}/duplicate`, { method: 'POST' }), ctx);

    expect(res.status).toBe(201);
    expect(prismaMock.rubric.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Correct or incorrect (copy)',
          description: 'Binary',
          definition: { version: 1, kind: 'binary' },
          ownerId: 'fac-1',
        },
      }),
    );
    expect((await res.json()).canEdit).toBe(true);
    expect(actions()).toContain('RUBRIC_DUPLICATED');
  });

  it('404s one the caller cannot see', async () => {
    prismaMock.rubric.findFirst.mockResolvedValue(null);

    const res = await DUPLICATE(new Request(`${url}/duplicate`, { method: 'POST' }), ctx);

    expect(res.status).toBe(404);
  });
});
