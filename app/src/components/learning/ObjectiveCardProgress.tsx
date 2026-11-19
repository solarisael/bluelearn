import { useLearningOverview } from "@/lib/useLearning";

export function ObjectiveCardProgress({ slug }: { slug: string }) {
  const progress = useLearningOverview();

  if (!progress.signedIn) return null;
  if (progress.error)
    return (
      <p className="text-xs text-destructive">Could not load your progress.</p>
    );
  if (!progress.data)
    return <p className="text-xs text-muted-foreground">Loading...</p>;

  const objective = progress.data.find((item) => item.slug === slug);

  if (!objective?.enrollment)
    return <p className="text-xs text-muted-foreground">Not started</p>;

  const { counts, enrollment } = objective;

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {counts.read} / {counts.included} steps read
        {enrollment.completed_at ? " · Completed" : ""}
      </p>
      {(counts.requested > 0 || counts.unavailable > 0) && (
        <p>
          {counts.requested} requested · {counts.unavailable} unavailable
        </p>
      )}
    </div>
  );
}
