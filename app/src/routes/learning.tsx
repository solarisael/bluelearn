import { useCallback, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/auth";
import { getLearningObjectives } from "@/lib/api/learning";
import { useLearningResource } from "@/lib/useLearning";
import { LearningFailure } from "@/components/learning/ReaderLearning";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/learning")({
  ssr: false,
  beforeLoad: requireSession,
  component: LearningPage,
});

function LearningPage() {
  const [page, setPage] = useState(1);
  const load = useCallback(
    (signal: AbortSignal) =>
      getLearningObjectives({ page, limit: 20 }, { signal }),
    [page]
  );
  const progress = useLearningResource(`objectives:${page}`, load);
  const data = progress.data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold">Your learning</h1>
      <div className="flex flex-wrap gap-3">
        <Link to="/history" className="btn-outline">
          Reading history
        </Link>
        <Link to="/settings/learning" className="btn-outline">
          Learning preferences
        </Link>
      </div>
      <LearningFailure error={progress.error} refresh={progress.refresh} />
      {progress.loading && <p role="status">Loading objectives...</p>}
      {data && data.objectives.length === 0 && (
        <p>No objectives started yet.</p>
      )}
      <ul className="space-y-4">
        {data?.objectives.map((objective) => (
          <li
            key={objective.objective_id}
            className="space-y-2 rounded-lg border p-4"
          >
            <h2 className="text-lg font-semibold">{objective.title}</h2>
            <p>
              {objective.counts.read} / {objective.counts.included} steps read
            </p>
            {(objective.counts.requested > 0 ||
              objective.counts.unavailable > 0) && (
              <p className="text-sm text-muted-foreground">
                {objective.counts.requested} not yet written ·{" "}
                {objective.counts.unavailable} unavailable
              </p>
            )}
            {objective.enrollment?.completed_at ? (
              <p className="text-sm">
                Completed{" "}
                {new Date(
                  objective.enrollment.completed_at
                ).toLocaleDateString()}
              </p>
            ) : (
              <p className="text-sm">
                {objective.enrollment ? "In progress" : "Not started"}
              </p>
            )}
            {objective.enrollment &&
              objective.enrollment.objective_revision_id !==
                objective.current_revision_id && (
                <p className="text-sm text-muted-foreground">
                  New version available.
                </p>
              )}
            <Link
              to="/objectives/$slug"
              params={{ slug: objective.slug }}
              state={{ analyticsSource: "resume" }}
              className="btn-outline"
            >
              View objective
            </Link>
          </li>
        ))}
      </ul>
      {data && (
        <nav
          aria-label="Learning pages"
          className="flex items-center justify-between gap-3"
        >
          <Button
            variant="outline"
            size="lg"
            className="btn-outline"
            disabled={page === 1 || progress.loading}
            onClick={() => setPage(page - 1)}
          >
            Previous page
          </Button>
          <span className="text-sm">
            Page {page} · {data.total} objectives
          </span>
          <Button
            variant="outline"
            size="lg"
            className="btn-outline"
            disabled={page * 20 >= data.total || progress.loading}
            onClick={() => setPage(page + 1)}
          >
            Next page
          </Button>
        </nav>
      )}
    </main>
  );
}
