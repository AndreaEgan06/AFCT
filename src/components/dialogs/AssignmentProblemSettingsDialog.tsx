'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import SelectField from '@/components/ui/SelectField';
import { LimitField } from '@/components/ui/LimitField';
import Link from 'next/link';

import { useEffect, useState } from 'react';

import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';

export type AssignmentProblemSettings = {
  maxPoints: number;
  // -1 means unlimited; otherwise the accepted-submission limit (>= 1).
  maxSubmissions: number;
  autograderEnabled: boolean;
  /** Whether students see the evaluator's feedback, or only whether they were right. */
  showFeedback?: boolean;
};

type AssignmentProblemSettingsDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  assignmentId: string;
  problemId: string;
  problemTitle: string;
  settings: AssignmentProblemSettings;
  courseIsArchived: boolean;
  onSaved?: () => void;
};

/** The picker's value for "no rubric"; a Radix select cannot use the empty string. */
const NO_RUBRIC = 'none';

/** What the picker needs from each rubric the caller can attach here. */
type RubricOption = { id: string; name: string; owner: { name: string }; canEdit: boolean };

/**
 * Edits how one problem counts inside one assignment: points, accepted-submission cap
 * (unlimited or a number), whether it is autograded, and which rubric grades it. These live on the
 * AssignmentProblem link, so the same problem can have different values in each
 * assignment. The problem definition itself is edited in the course problem bank.
 */
export function AssignmentProblemSettingsDialog({
  open,
  setOpen,
  courseId,
  assignmentId,
  problemId,
  problemTitle,
  settings,
  courseIsArchived,
  onSaved,
}: AssignmentProblemSettingsDialogProps) {
  const [maxPoints, setMaxPoints] = useState<string>(String(settings.maxPoints ?? 0));
  const [unlimited, setUnlimited] = useState<boolean>(settings.maxSubmissions === -1);
  const [maxSubmissions, setMaxSubmissions] = useState<string>(
    settings.maxSubmissions === -1 ? '' : String(settings.maxSubmissions),
  );
  const [autograderEnabled, setAutograderEnabled] = useState<boolean>(settings.autograderEnabled);
  const [showFeedback, setShowFeedback] = useState<boolean>(settings.showFeedback !== false);
  const [saving, setSaving] = useState(false);
  /**
   * Attempts already made against this problem, and what the setting was when the dialog
   * opened. Together they decide whether changing the switch needs a word of warning: students
   * who have already submitted keep whatever they were shown, so a change partway through
   * leaves the class split. Null until the count arrives, which is the same as "no warning".
   */
  const [attemptsSoFar, setAttemptsSoFar] = useState<number | null>(null);
  const [savedShowFeedback, setSavedShowFeedback] = useState<boolean>(
    settings.showFeedback !== false,
  );
  /**
   * RUBRIC: the picker. Null until the current choice has been read; until then nothing about
   * the rubric is sent, so a dialog that could not load it cannot clear it by saving.
   */
  const [rubricId, setRubricId] = useState<string | null>(null);
  const [rubricOptions, setRubricOptions] = useState<RubricOption[]>([]);

  // Re-seed from the passed settings each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setMaxPoints(String(settings.maxPoints ?? 0));
    setUnlimited(settings.maxSubmissions === -1);
    setMaxSubmissions(settings.maxSubmissions === -1 ? '' : String(settings.maxSubmissions));
    setAutograderEnabled(settings.autograderEnabled);
    setShowFeedback(settings.showFeedback !== false);
    setSaving(false);
  }, [open, settings]);

  // The count comes from the server rather than the assignment payload: nothing else on this
  // screen needs it, and it has to be current at the moment of the decision.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRubricId(null);
    void apiClient
      .get<{ showFeedback?: boolean; submissionCount?: number; rubricId?: string | null }>(
        apiPaths.assignmentProblem(courseId, assignmentId, problemId),
      )
      .then((data) => {
        if (cancelled) return;
        setAttemptsSoFar(data.submissionCount ?? 0);
        setSavedShowFeedback(data.showFeedback !== false);
        setRubricId(data.rubricId ?? NO_RUBRIC);
      })
      .catch(() => {
        // The warning is a courtesy, not a gate. If the count cannot be read the dialog still
        // saves; it just says nothing about attempts.
        if (!cancelled) setAttemptsSoFar(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, courseId, assignmentId, problemId]);

  // The rubrics that can be attached here: the caller's own, and any already used in this course.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void apiClient
      .get<{ rubrics?: RubricOption[] }>(apiPaths.rubrics({ courseId }))
      .then((data) => {
        if (!cancelled) setRubricOptions(data.rubrics ?? []);
      })
      .catch(() => {
        if (!cancelled) setRubricOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  const pointsValue = Number(maxPoints);
  const pointsInvalid = !Number.isFinite(pointsValue) || pointsValue < 0;
  const submissionsValue = Number(maxSubmissions);
  const submissionsInvalid =
    !unlimited && (!Number.isInteger(submissionsValue) || submissionsValue < 1);
  const canSave = !pointsInvalid && !submissionsInvalid && !saving && !courseIsArchived;

  /**
   * Said before saving, not after: work already handed in was seen under the old setting, and
   * a student who has read the evaluator's feedback cannot unread it. Changing this partway
   * through is allowed, and it should be a decision rather than a surprise.
   */
  const feedbackChangeWarning =
    showFeedback !== savedShowFeedback && attemptsSoFar && attemptsSoFar > 0
      ? showFeedback
        ? `${attemptsSoFar} ${attemptsSoFar === 1 ? 'attempt has' : 'attempts have'} already been made without feedback. Turning it on shows the feedback for those attempts too.`
        : `${attemptsSoFar} ${attemptsSoFar === 1 ? 'attempt has' : 'attempts have'} already been made with feedback shown. Turning it off hides it from now on, including on those attempts, but anyone who has already read it has seen it.`
      : null;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiClient.put(apiPaths.assignmentProblem(courseId, assignmentId, problemId), {
        maxPoints: Math.max(0, pointsValue),
        maxSubmissions: unlimited ? -1 : Math.max(1, Math.floor(submissionsValue)),
        autograderEnabled,
        showFeedback,
        // RUBRIC: only once the current choice is known; omitted leaves it as it is.
        ...(rubricId !== null ? { rubricId: rubricId === NO_RUBRIC ? null : rubricId } : {}),
      });
      showToast.updated('Problem settings');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Problem Settings</DialogTitle>
          <DialogDescription>
            How &ldquo;{problemTitle}&rdquo; counts in this assignment. These apply to this
            assignment only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InputGroup
            label="Max Points"
            name="assignment-problem-max-points"
            type="number"
            min={0}
            step="1"
            value={maxPoints}
            setValue={setMaxPoints}
            error={pointsInvalid ? 'Max points must be zero or greater.' : undefined}
          />

          <LimitField
            label="Accepted Submissions"
            name="assignment-problem-max-submissions"
            unlimited={unlimited}
            onUnlimitedChange={setUnlimited}
            value={maxSubmissions}
            onValueChange={setMaxSubmissions}
            min={1}
            placeholder="e.g. 5"
            error={
              submissionsInvalid ? 'Enter a number of at least 1, or choose Unlimited.' : undefined
            }
          />

          <SwitchField
            label="Automatically Graded"
            name="assignment-problem-autograder"
            id="assignment-problem-autograder"
            checked={autograderEnabled}
            onCheckedChange={(checked) => setAutograderEnabled(!!checked)}
            descriptionPlacement="inline"
            description="When enabled, submissions are evaluated and graded automatically. Turn this off if you want to review and grade submissions manually."
          />

          <SwitchField
            label="Show Feedback to Students"
            name="assignment-problem-show-feedback"
            id="assignment-problem-show-feedback"
            checked={showFeedback}
            onCheckedChange={(checked) => setShowFeedback(!!checked)}
            descriptionPlacement="inline"
            description="When disabled, students see only whether their submission was correct. Feedback is still recorded and remains visible to instructors."
          />

          <SelectField
            label="Rubric"
            name="assignment-problem-rubric"
            id="assignment-problem-rubric"
            value={rubricId ?? NO_RUBRIC}
            onValueChange={setRubricId}
            disabled={rubricId === null}
            options={[
              { value: NO_RUBRIC, label: 'None (full points when correct)' },
              ...rubricOptions.map((r) => ({
                value: r.id,
                label: r.canEdit ? r.name : `${r.name} (${r.owner.name})`,
              })),
            ]}
            description="How a graded attempt becomes points. Rubrics are kept in your library and can be reused on any problem."
          />
          <p className="text-muted-foreground -mt-2 text-sm">
            <Link href="/dashboard/rubrics" className="underline underline-offset-2">
              Manage rubrics
            </Link>
          </p>

          {/*
            The one live region in this dialog. The warning appears in response to flipping the
            switch, and a message that only arrives visually is no warning at all to somebody
            using a screen reader: they would toggle the setting, hear the switch state, and be
            told nothing about the attempts already made under the other one.

            Mounted always, filled conditionally. A region inserted at the same moment as its
            text is not reliably announced, which is the same reason the problem workspace keeps
            its status region mounted and empty.
          */}
          <div role="status" aria-live="polite">
            {feedbackChangeWarning && (
              <p className="border-status-warning-border bg-status-warning-bg text-status-warning rounded-md border px-3 py-2 text-sm">
                {feedbackChangeWarning}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
