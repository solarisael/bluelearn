import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/authContext";
import { recordLearningVisit, setLearningRead } from "@/lib/api/learning";
import {
  learningErrorCategory,
  learningErrorMessage,
  useLearningMutation,
  useLearningReads,
} from "@/lib/useLearning";
import { analyticsSource, newAnalyticsEventId } from "@/lib/telemetry";

export type DisplayedGuide = {
  guideId: string;
  revisionId: string;
};

function useReaderOpen(guide: DisplayedGuide) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const navigation = `${location.pathname}${location.searchStr}:${guide.guideId}:${guide.revisionId}`;
  type Visit = {
    navigation: string;
    eventId: string;
    sent: boolean;
    account?: string;
    history?: Parameters<typeof recordLearningVisit>[0];
    saving?: boolean;
  };
  const visit = useRef<Visit | null>(null);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const [failure, setFailure] = useState<{
    eventId: string;
    account: string;
    error: Error;
  } | null>(null);
  const source = analyticsSource(
    location.state.analyticsSource ?? location.state.breadcrumbOrigin?.type
  );
  const saveHistory = useCallback(async (attempt: Visit) => {
    if (!attempt.history || attempt.saving || owner.current !== attempt.account)
      return;

    attempt.saving = true;
    setFailure(null);

    try {
      await recordLearningVisit(attempt.history);
    } catch (error) {
      if (visit.current !== attempt || owner.current !== attempt.account)
        return;

      setFailure({
        eventId: attempt.eventId,
        account: attempt.account!,
        error:
          error instanceof Error
            ? error
            : new Error("Could not save this visit."),
      });
    } finally {
      attempt.saving = false;
    }
  }, []);

  useEffect(() => {
    if (loading || navigating) return;

    if (visit.current?.navigation !== navigation) {
      visit.current = {
        navigation,
        eventId: newAnalyticsEventId(),
        sent: false,
      };
    }

    const record = () => {
      if (document.visibilityState !== "visible" || visit.current?.sent) return;

      const current = visit.current!;
      current.sent = true;

      if (user) {
        current.account = user.id;
        current.history = {
          event_id: current.eventId,
          guide_id: guide.guideId,
          revision_id: guide.revisionId,
          source,
        };
        void saveHistory(current);
      }
    };

    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [
    navigation,
    navigating,
    loading,
    user,
    source,
    guide.guideId,
    guide.revisionId,
    saveHistory,
  ]);

  return {
    error:
      visit.current?.navigation === navigation &&
      failure?.eventId === visit.current.eventId &&
      failure.account === user?.id
        ? failure.error
        : undefined,
    retry: () => {
      if (visit.current?.navigation === navigation)
        void saveHistory(visit.current);
    },
  };
}

export function LearningFailure({
  error,
  refresh,
}: {
  error: unknown;
  refresh?: () => void;
}) {
  if (!error) return null;

  const conflict = learningErrorCategory(error) === "conflict";

  return (
    <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>
        {conflict
          ? "This version changed. Refresh to continue."
          : learningErrorMessage(error)}
      </p>
      {refresh && (
        <Button
          variant="outline"
          size="lg"
          className="btn-sec"
          onClick={refresh}
        >
          {conflict ? "Refresh content" : "Retry"}
        </Button>
      )}
    </div>
  );
}

export function ReaderLearning({ guide }: { guide: DisplayedGuide }) {
  const router = useRouter();
  const reads = useLearningReads([guide.guideId]);
  const mutation = useLearningMutation(`${guide.guideId}:${guide.revisionId}`);
  const read = reads.data?.reads.find(
    (item) => item.guide_id === guide.guideId
  );
  const visit = useReaderOpen(guide);

  return (
    <section
      aria-label="Your learning"
      className="my-6 space-y-4 rounded-lg border p-4"
    >
      {reads.signedIn ? (
        <>
          <Button
            variant="outline"
            size="lg"
            className="btn-sec"
            disabled={
              reads.loading ||
              Boolean(reads.error) ||
              mutation.pending ||
              learningErrorCategory(mutation.error) === "conflict"
            }
            aria-pressed={Boolean(read)}
            onClick={() =>
              void mutation.run(() =>
                setLearningRead(guide.guideId, {
                  revision_id: guide.revisionId,
                  read: !read,
                })
              )
            }
          >
            {mutation.pending
              ? "Saving..."
              : read
                ? "Mark as unread"
                : "Mark as read"}
          </Button>
          {read?.has_newer_revision && (
            <p className="text-sm text-muted-foreground">
              New version available.
            </p>
          )}
          <LearningFailure error={reads.error} refresh={reads.refresh} />
          <LearningFailure
            error={mutation.error}
            refresh={
              learningErrorCategory(mutation.error) === "conflict"
                ? () => {
                    void router.invalidate();
                    reads.refresh();
                  }
                : undefined
            }
          />
        </>
      ) : !reads.loading ? (
        <p className="text-sm text-muted-foreground">
          <Link to="/login" className="underline">
            Sign in
          </Link>{" "}
          to save your progress.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      <LearningFailure
        error={visit.error}
        refresh={
          learningErrorCategory(visit.error) === "conflict"
            ? () => window.location.reload()
            : undefined
        }
      />
      {visit.error && learningErrorCategory(visit.error) !== "conflict" && (
        <Button
          variant="outline"
          size="lg"
          className="btn-sec"
          onClick={visit.retry}
        >
          Retry saving visit
        </Button>
      )}
    </section>
  );
}
