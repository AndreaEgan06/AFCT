import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isCourseStaffAnywhere } from '@/lib/permissions';
import RubricsClient from './RubricsClient';
import { WorkspaceSurface } from '@/components/WorkspaceSurface';

export const metadata: Metadata = {
  title: 'Rubrics',
};

// RUBRIC: the rubric library page (see RUBRIC_LOCATIONS.md).
export default async function RubricsPage() {
  // Staff tooling, like the Evaluator Sandbox: gate the page itself, and 404 rather than 403.
  const session = await auth();
  if (!(await isCourseStaffAnywhere(session?.user))) {
    notFound();
  }

  return (
    <WorkspaceSurface>
      <RubricsClient />
    </WorkspaceSurface>
  );
}
