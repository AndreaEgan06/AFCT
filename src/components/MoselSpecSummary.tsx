/**
 * A problem's language description where its answer file would be shown, for a problem that
 * is marked against the description alone. Staff only: the description is an answer key.
 */
export function MoselSpecSummary({ summary }: { summary: string }) {
  return (
    <span className="flex min-w-0 flex-col text-xs">
      <span className="text-muted-foreground">Language description</span>
      <code className="font-mono break-all" title={summary}>
        {summary}
      </code>
    </span>
  );
}
