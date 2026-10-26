/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RubricsClient from './RubricsClient';

// RUBRIC: the rubric library page.

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const rubric = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Correct or incorrect',
  description: null,
  definition: { version: 1, kind: 'binary' },
  owner: { id: 'me', name: 'Me' },
  usageCount: 0,
  canEdit: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RubricsClient />
    </QueryClientProvider>,
  );
};

const calls = (method: string) =>
  fetchMock.mock.calls.filter(
    (c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RubricsClient', () => {
  it('lists rubrics, says what each does, and marks one somebody else owns', async () => {
    fetchMock.mockResolvedValue(
      json({
        rubrics: [
          rubric(),
          rubric({
            id: 'r2',
            name: 'Shared',
            owner: { id: 'x', name: 'Dr. Lee' },
            canEdit: false,
            usageCount: 3,
          }),
        ],
      }),
    );

    renderPage();

    const mine = (await screen.findByText('Correct or incorrect')).closest('li')!;
    expect(
      within(mine).getByText('Full points when correct, nothing otherwise.'),
    ).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: /Rename/ })).toBeInTheDocument();
    const theirs = screen.getByText('Shared').closest('li')!;
    expect(within(theirs).getByText('Dr. Lee')).toBeInTheDocument();
    expect(within(theirs).getByText(/Used on 3 problems/)).toBeInTheDocument();
    // Not theirs to change, but theirs to copy.
    expect(within(theirs).queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(theirs).getByRole('button', { name: /Duplicate/ })).toBeInTheDocument();
  });

  it('will not offer to delete a rubric that is in use', async () => {
    fetchMock.mockResolvedValue(json({ rubrics: [rubric({ usageCount: 1 })] }));

    renderPage();

    expect(await screen.findByRole('button', { name: /Delete/ })).toBeDisabled();
  });

  it('creates one from a name and a description', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(rubric({ id: 'r9' }), 201) : json({ rubrics: [] }),
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /New Rubric/ }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Homework' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'For HW' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rubric' }));

    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    const [url, init] = calls('POST')[0] as [string, RequestInit];
    expect(url).toBe('/api/rubrics');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Homework', description: 'For HW' });
  });

  it('duplicates one', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(rubric({ id: 'r2' }), 201) : json({ rubrics: [rubric()] }),
    );

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Duplicate/ }));

    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0]![0]).toBe('/api/rubrics/r1/duplicate');
  });
});
