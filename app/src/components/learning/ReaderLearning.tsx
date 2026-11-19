import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { ObjectiveGuideSearch } from "@/lib/objectiveSnapshot";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/authContext";
import { getObjective } from "@/lib/api/objectives";
import { getObjectiveRevision } from "@/lib/api/objectiveRevisions";
import {
  recordLearningVisit,
  saveLearningPosition,
  setLearningRead,
} from "@/lib/api/learning";
import {
  learningErrorCategory,
  learningErrorMessage,
  useLearningMutation,
  useLearningObjective,
  useLearningReads,
  useLearningResource,
} from "@/lib/useLearning";
import { findGuideNeighbours } from "@/lib/objectiveSnapshot";
import { analyticsSource, newAnalyticsEventId } from "@/lib/telemetry";
import { queueLearningPosition } from "@/lib/learningPositionQueue";

export type DisplayedGuide = {
  guideId: string;
  guideBaseId: string;
  revisionId: string;
  slug: string;
};

function useReaderObjectiveContext(
  guide: DisplayedGuide,
  search: ObjectiveGuideSearch
) {
  const progress = useLearningObjective(search.objective);
  const revision =
    search.revision ?? progress.data?.enrollment?.objective_revision_id;
  const load = useCallback(
    async (signal: AbortSignal) => {
      const current = await getObjective(search.objective!, { signal });
      const detail =
        revision && revision !== current.objective.current_revision_id
          ? await getObjectiveRevision(revision, { signal })
          : current;

      return { ...current, snapshot: detail.snapshot };
    },
    [search.objective, revision]
  );
  const sequence = useLearningResource(
    search.objective && !progress.loading
      ? `sequence:${search.objective}:${revision ?? "current"}`
      : null,
    load,
    false
  );
  const snapshot = sequence.data?.snapshot;
  const neighbours = snapshot
    ? findGuideNeighbours(snapshot, guide.slug, search.target, guide.guideId)
    : null;
  const selectedTarget = search.target
    ? snapshot?.nodes.find(
        (node) =>
          node.is_target &&
          node.is_included &&
          (node.id === search.target || node.guide_base_id === search.target)
      )
    : undefined;
  const target =
    selectedTarget ??
    snapshot?.nodes.find(
      (node) =>
        node.is_target &&
        node.is_included &&
        node.guide_base_id !== null &&
        node.guide_base_id === progress.data?.enrollment?.target_guide_base_id
    ) ??
    snapshot?.nodes.find((node) => node.id === neighbours?.targetId);

  return { progress, revision, sequence, snapshot, neighbours, target };
}

type ReaderObjectiveContext = ReturnType<typeof useReaderObjectiveContext>;

function useReaderOpen(
  guide: DisplayedGuide,
  search: ObjectiveGuideSearch,
  context: ReaderObjectiveContext
) {
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
  const { progress, revision, sequence, snapshot, target } = context;
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
    if (
      loading ||
      navigating ||
      (search.objective && (progress.loading || sequence.loading))
    )
      return;

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
      const objective = sequence.data?.objective;
      const objectiveRevision = revision ?? objective?.current_revision_id;
      const matchingStep = snapshot?.nodes.some(
        (node) => node.is_included && node.guide_id === guide.guideId
      );
      const objectiveContext =
        matchingStep && objectiveRevision && objective
          ? {
              objective_id: objective.id,
              objective_revision_id: objectiveRevision,
            }
          : {};

      if (user) {
        current.account = user.id;
        const targetGuideBaseId = target?.guide_base_id;
        current.history = {
          event_id: current.eventId,
          guide_id: guide.guideId,
          revision_id: guide.revisionId,
          source,
          ...objectiveContext,
          ...(matchingStep
            ? { target_guide_base_id: targetGuideBaseId ?? undefined }
            : {}),
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
    search.objective,
    progress.loading,
    revision,
    sequence.loading,
    sequence.data,
    snapshot,
    target,
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

export function ReaderLearning({
  guide,
  search,
}: {
  guide: DisplayedGuide;
  search: ObjectiveGuideSearch;
}) {
  const router = useRouter();
  const reads = useLearningReads([guide.guideId]);
  const mutation = useLearningMutation(`${guide.guideId}:${guide.revisionId}`);
  const read = reads.data?.reads.find(
    (item) => item.guide_id === guide.guideId
  );
  const objectiveContext = useReaderObjectiveContext(guide, search);
  const visit = useReaderOpen(guide, search, objectiveContext);

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
      {search.objective && (
        <ReaderObjective
          guide={guide}
          search={search}
          context={objectiveContext}
        />
      )}
    </section>
  );
}

function ReaderObjective({
  guide,
  search,
  context,
}: {
  guide: DisplayedGuide;
  search: ObjectiveGuideSearch;
  context: ReaderObjectiveContext;
}) {
  const { progress, revision, sequence, neighbours, target } = context;
  const location = useLocation();
  const position = useLearningMutation(
    `${search.objective}:${progress.data?.enrollment?.objective_revision_id}:${guide.guideBaseId}:${location.pathname}${location.searchStr}`
  );
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const account = useAuth().user?.id;
  const saved = useRef<string | null>(null);
  const enrollment = progress.data?.enrollment;
  const expectedRevision = enrollment?.objective_revision_id;
  const positionKey = `${account}:${location.pathname}${location.searchStr}:${expectedRevision}:${guide.guideBaseId}`;
  const canSave = Boolean(
    enrollment &&
    !enrollment.completed_at &&
    (!search.revision || search.revision === expectedRevision) &&
    progress.data?.steps.some((step) => step.guide_id === guide.guideId)
  );

  const save = () =>
    queueLearningPosition(
      `${account}:${progress.data!.objective_id}`,
      position.isCurrent,
      () =>
        position.run(() =>
          saveLearningPosition(search.objective!, {
            expected_revision_id: expectedRevision!,
            guide_base_id: guide.guideBaseId,
            target_guide_base_id: target?.guide_base_id ?? undefined,
          })
        )
    );

  useEffect(() => {
    if (!canSave || navigating || progress.loading || sequence.loading) return;

    const move = () => {
      if (
        document.visibilityState !== "visible" ||
        saved.current === positionKey
      )
        return;

      saved.current = positionKey;
      void save();
    };
    move();
    document.addEventListener("visibilitychange", move);
    return () => document.removeEventListener("visibilitychange", move);
  }, [canSave, navigating, progress.loading, sequence.loading, positionKey]);

  const objectiveSearch = {
    objective: search.objective,
    target: neighbours?.targetId ?? search.target,
    revision:
      revision ?? sequence.data?.objective.current_revision_id ?? undefined,
  };

  return (
    <div className="space-y-3">
      <Link
        to="/objectives/$slug"
        params={{ slug: search.objective! }}
        className="text-sm underline"
      >
        Return to {sequence.data?.objective.title ?? "objective"}
      </Link>
      <LearningFailure error={progress.error} refresh={progress.refresh} />
      <LearningFailure error={sequence.error} refresh={sequence.refresh} />
      <LearningFailure
        error={position.error}
        refresh={
          learningErrorCategory(position.error) === "conflict"
            ? progress.refresh
            : undefined
        }
      />
      {position.error &&
        canSave &&
        learningErrorCategory(position.error) !== "conflict" && (
          <Button
            variant="outline"
            size="lg"
            className="btn-sec"
            disabled={position.pending}
            onClick={() => void save()}
          >
            Retry saving position
          </Button>
        )}
      {neighbours && (
        <nav
          aria-label="Objective guides"
          className="flex flex-wrap justify-between gap-3"
        >
          {[
            { node: neighbours.prev, label: "Previous" },
            { node: neighbours.next, label: "Next" },
          ].map(
            ({ node, label }) =>
              node && (
                <Link
                  key={label}
                  to="/guides/$slug/$variantSlug"
                  params={{ slug: node.slug, variantSlug: node.variantSlug }}
                  search={objectiveSearch}
                  state={{ analyticsSource: "objective" }}
                  className="btn-outline"
                >
                  {label}: {node.title}
                </Link>
              )
          )}
        </nav>
      )}
    </div>
  );
}
