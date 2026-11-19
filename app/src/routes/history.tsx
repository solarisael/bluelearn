import { useCallback, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/auth";
import {
  clearLearningHistory,
  getLearningHistory,
  removeLearningVisit,
  updateLearningPreferences,
} from "@/lib/api/learning";
import { useLearningMutation, useLearningResource } from "@/lib/useLearning";
import { Button } from "@/components/ui/button";
import { LearningFailure } from "@/components/learning/ReaderLearning";

export const Route = createFileRoute("/history")({
  ssr: false,
  beforeLoad: requireSession,
  component: HistoryPage,
});

function HistoryPage() {
  const [page, setPage] = useState(1);
  const load = useCallback(
    (signal: AbortSignal) =>
      getLearningHistory({ page, limit: 20 }, { signal }),
    [page]
  );
  const history = useLearningResource(`history:${page}`, load);
  const mutation = useLearningMutation();
  const data = history.data;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold">Reading history</h1>
      <p className="text-sm text-muted-foreground">
        Private · Last {data?.retention_days ?? 90} days
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          size="lg"
          className="btn-sec"
          disabled={!data || mutation.pending || history.loading}
          onClick={() =>
            void mutation.run(() =>
              updateLearningPreferences({ history_paused: !data!.paused })
            )
          }
        >
          {data?.paused ? "Resume history" : "Pause history"}
        </Button>
        <Button
          variant="destructive"
          size="lg"
          className="btn-danger"
          disabled={!data?.total || mutation.pending || history.loading}
          onClick={() => {
            if (!window.confirm("Clear all reading history?")) return;

            void mutation.run(async () => {
              await clearLearningHistory();
              setPage(1);
              return true;
            });
          }}
        >
          Clear history
        </Button>
        <Link to="/settings/learning" className="btn-outline">
          Learning preferences
        </Link>
      </div>
      {data?.paused && (
        <p role="status" className="text-sm">
          History paused.
        </p>
      )}
      <LearningFailure error={history.error} refresh={history.refresh} />
      <LearningFailure error={mutation.error} />
      {history.loading && <p role="status">Loading history...</p>}
      {data && data.visits.length === 0 && <p>No visits on this page.</p>}
      <ul className="space-y-3">
        {data?.visits.map((visit) => (
          <li
            key={visit.guide_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          >
            <div className="min-w-0 space-y-1">
              {visit.available && visit.slug && visit.variant_slug ? (
                <Link
                  to="/guides/$slug/$variantSlug"
                  params={{ slug: visit.slug, variantSlug: visit.variant_slug }}
                  state={{ analyticsSource: "history" }}
                  className="font-semibold underline"
                >
                  {visit.title ?? "Untitled guide"}
                </Link>
              ) : (
                <p className="font-semibold">Unavailable guide</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(visit.visited_at).toLocaleString()} · {visit.source}
              </p>
            </div>
            <Button
              variant="outline"
              size="lg"
              className="btn-sec"
              disabled={mutation.pending}
              aria-label={`Remove ${visit.available ? (visit.title ?? "guide") : "unavailable guide"} from history`}
              onClick={() =>
                void mutation.run(async () => {
                  await removeLearningVisit(visit.guide_id);
                  if (data.visits.length === 1 && page > 1) setPage(page - 1);

                  return true;
                })
              }
            >
              Remove visit
            </Button>
          </li>
        ))}
      </ul>
      {data && (
        <nav
          aria-label="History pages"
          className="flex items-center justify-between gap-3"
        >
          <Button
            variant="outline"
            size="lg"
            className="btn-outline"
            disabled={page === 1 || history.loading || mutation.pending}
            onClick={() => setPage(page - 1)}
          >
            Previous page
          </Button>
          <span className="text-sm">
            Page {page} · {data.total} visits
          </span>
          <Button
            variant="outline"
            size="lg"
            className="btn-outline"
            disabled={
              page * 20 >= data.total || history.loading || mutation.pending
            }
            onClick={() => setPage(page + 1)}
          >
            Next page
          </Button>
        </nav>
      )}
    </main>
  );
}
