'use client';

// RUBRIC: the rubric library page. While only the binary kind exists there is nothing to
// configure, so a rubric is a name and a description; the definition editor goes here once the
// shape is decided (see RUBRIC_LOCATIONS.md).

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Copy, Pencil, Plus, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import InputGroup from '@/components/ui/InputGroup';
import { FieldLabelRow } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import Spinner from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { fetchJson } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { showToast } from '@/lib/toast';
import { PAGE_HEADER_ICON_CLASS } from '@/lib/page-header';
import type { RubricView } from '@/lib/rubrics';

type Usage = {
  course: { id: string; name: string; code: string };
  assignment: { id: string; title: string };
  problem: { id: string; title: string };
};

/** What a rubric does, in words. RUBRIC: one sentence per kind. */
function describeDefinition(definition: unknown): string {
  const kind = (definition as { kind?: unknown } | null)?.kind;
  if (kind === 'binary') return 'Full points when correct, nothing otherwise.';
  return 'Unknown kind.';
}

/** Create or rename: the same two fields either way. */
function RubricFormDialog({
  open,
  setOpen,
  rubric,
  onSaved,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Null creates a new one. */
  rubric: RubricView | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(rubric?.name ?? '');
    setDescription(rubric?.description ?? '');
    setSaving(false);
  }, [open, rubric]);

  const nameError = name.trim() === '' ? 'Name is required.' : undefined;

  const save = async () => {
    if (nameError) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null };
      if (rubric) {
        await apiClient.patch(apiPaths.rubric(rubric.id), body);
        showToast.updated('Rubric', { name: body.name });
      } else {
        await apiClient.post(apiPaths.rubrics(), body);
        showToast.created('Rubric', { name: body.name });
      }
      onSaved();
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'The rubric could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{rubric ? 'Rename Rubric' : 'New Rubric'}</DialogTitle>
          <DialogDescription>
            {rubric
              ? 'Change what this rubric is called. How it grades stays the same.'
              : 'For now every rubric grades the same way: full points when correct, nothing otherwise.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <InputGroup
            label="Name"
            name="rubric-name"
            requiredMark
            value={name}
            setValue={setName}
            error={name === '' ? undefined : nameError}
          />
          <div className="flex flex-col gap-1">
            <FieldLabelRow htmlFor="rubric-description">Description</FieldLabelRow>
            <Textarea
              id="rubric-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional: what it is for"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={!!nameError || saving}>
            {saving ? 'Saving…' : rubric ? 'Save' : 'Create Rubric'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where a rubric is used, read when somebody asks rather than for every row. */
function UsageList({ rubricId }: { rubricId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.rubric(rubricId),
    queryFn: () => fetchJson<RubricView & { usage: Usage[] }>(apiPaths.rubric(rubricId)),
  });
  if (isLoading) return <Spinner />;
  if (isError || !data)
    return <p className="text-destructive text-sm">Could not load where it is used.</p>;
  if (data.usage.length === 0) {
    return <p className="text-muted-foreground text-sm">Used only in courses you do not teach.</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {data.usage.map((u) => (
        <li key={`${u.assignment.id}-${u.problem.id}`}>
          {u.problem.title} on {u.assignment.title}{' '}
          <span className="text-muted-foreground">({u.course.code})</span>
        </li>
      ))}
    </ul>
  );
}

export default function RubricsClient() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.rubrics(),
    queryFn: () => fetchJson<{ rubrics: RubricView[] }>(apiPaths.rubrics()),
  });
  const rubrics = data?.rubrics ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RubricView | null>(null);
  const [deleting, setDeleting] = useState<RubricView | null>(null);
  const [showUsage, setShowUsage] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.rubrics() });

  const duplicate = async (rubric: RubricView) => {
    try {
      await apiClient.post(apiPaths.rubricDuplicate(rubric.id));
      showToast.duplicated('Rubric', { name: rubric.name });
      await refresh();
    } catch (err) {
      showToast.error(
        err instanceof ApiError ? err.message : 'The rubric could not be duplicated.',
      );
    }
  };

  const remove = async (rubric: RubricView) => {
    try {
      await apiClient.del(apiPaths.rubric(rubric.id));
      showToast.deleted('Rubric', { name: rubric.name });
      await refresh();
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'The rubric could not be deleted.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="w-full max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <ClipboardCheck className={PAGE_HEADER_ICON_CLASS} aria-hidden="true" />
            <span>Rubrics</span>
          </h1>
          <p className="text-muted-foreground max-w-3xl text-sm">
            How an evaluated attempt becomes points. A rubric is yours rather than a course&rsquo;s,
            so you can attach the same one to as many problems as you like, from a problem&rsquo;s
            settings on an assignment. For now there is one kind: full points when correct, nothing
            otherwise, which grades exactly like having no rubric.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus aria-hidden="true" /> New Rubric
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <p role="alert" className="text-destructive text-sm">
          The rubrics could not be loaded.
        </p>
      ) : rubrics.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            No rubrics yet. Create one to attach it to problems.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rubrics.map((rubric) => (
            <li key={rubric.id}>
              <Card className="h-full">
                <CardHeader className="space-y-1">
                  <CardTitle aria-level={2} className="flex flex-wrap items-center gap-2">
                    {rubric.name}
                    {!rubric.canEdit && <Badge variant="neutral">{rubric.owner.name}</Badge>}
                  </CardTitle>
                  <CardDescription>
                    {rubric.description || describeDefinition(rubric.definition)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    {rubric.description && (
                      <span className="text-muted-foreground block">
                        {describeDefinition(rubric.definition)}
                      </span>
                    )}
                    {rubric.usageCount === 0
                      ? 'Not used on any problem.'
                      : `Used on ${rubric.usageCount} ${rubric.usageCount === 1 ? 'problem' : 'problems'}.`}{' '}
                    {rubric.usageCount > 0 && (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        aria-expanded={showUsage === rubric.id}
                        onClick={() => setShowUsage(showUsage === rubric.id ? null : rubric.id)}
                      >
                        {showUsage === rubric.id ? 'Hide where' : 'Show where'}
                      </button>
                    )}
                  </p>
                  {showUsage === rubric.id && <UsageList rubricId={rubric.id} />}
                  <div className="flex flex-wrap gap-2">
                    {rubric.canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditing(rubric);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil aria-hidden="true" /> Rename
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => void duplicate(rubric)}>
                      <Copy aria-hidden="true" /> Duplicate
                    </Button>
                    {rubric.canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleting(rubric)}
                        disabled={rubric.usageCount > 0}
                        title={
                          rubric.usageCount > 0
                            ? 'Remove it from every problem before deleting it.'
                            : undefined
                        }
                      >
                        <Trash2 aria-hidden="true" /> Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <RubricFormDialog
        open={formOpen}
        setOpen={setFormOpen}
        rubric={editing}
        onSaved={() => void refresh()}
      />

      <ConfirmDialog
        open={deleting !== null}
        variant="destructive"
        title="Delete rubric?"
        description={`"${deleting?.name ?? ''}" will be removed from your library.`}
        confirmText="Delete rubric"
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
