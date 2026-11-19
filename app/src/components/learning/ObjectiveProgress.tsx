import { useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { useLearningObjective } from "@/lib/useLearning";
import { Button } from "@/components/ui/button";
import { LearningFailure } from "@/components/learning/ReaderLearning";
import { changeLearningObjective } from "@/lib/api/learning";
import { useLearningMutation } from "@/lib/useLearning";
import { newAnalyticsEventId } from "@/lib/telemetry";
import { canCompleteObjective, resumeStep } from "@/lib/learningProgress";
import { useAuth } from "@/lib/authContext";

type Props = {
  slug: string;
  progress: ReturnType<typeof useLearningObjective>;
  targetGuideBaseId?: string;
  reopenTargetGuideBaseId?: string;
};

export function ObjectiveProgress({
  slug,
  progress,
  targetGuideBaseId,
  reopenTargetGuideBaseId,
}: Props) {
  const mutation = useLearningMutation();
  const account = useAuth().user?.id;
  const navigate = useNavigate();
  const attempt = useRef<{ key: string; eventId: string } | null>(null);
  const state = progress.data;

  if (!progress.signedIn && !progress.loading) {
    return (
      <p className="my-4 text-sm text-muted-foreground">
        <Link to="/login" className="underline">
          Sign in
        </Link>{" "}
        to start this objective.
      </p>
    );
  }
  if (!state) {
    return (
      <div className="my-4">
        <LearningFailure error={progress.error} refresh={progress.refresh} />
        {progress.loading && <p>Loading progress...</p>}
      </div>
    );
  }

  const enrollment = state.enrollment;
  const revision =
    enrollment?.objective_revision_id ?? state.current_revision_id;
  const complete = Boolean(enrollment?.completed_at);
  const ready = canCompleteObjective(state.counts);
  const canResume = Boolean(resumeStep(state));
  const position = state.steps.find(
    (step) => step.guide_base_id === enrollment?.position_guide_base_id
  );

  async function act(action: "start" | "resume" | "complete" | "reopen") {
    const expected =
      action === "reopen" ? state!.current_revision_id : revision;
    const target =
      action === "reopen" ? reopenTargetGuideBaseId : targetGuideBaseId;
    const key = `${account}:${slug}:${action}:${expected}:${target ?? ""}`;

    if (attempt.current?.key !== key)
      attempt.current = { key, eventId: newAnalyticsEventId() };

    const saved = await mutation.run(() =>
      changeLearningObjective(slug, action, {
        event_id: attempt.current!.eventId,
        expected_revision_id: expected,
        target_guide_base_id: target,
      })
    );

    if (!saved) return;

    attempt.current = null;
    if (action === "resume" || action === "start") {
      const step = resumeStep(saved);

      if (!step?.slug || !step.variant_slug) return;

      void navigate({
        to: "/guides/$slug/$variantSlug",
        params: { slug: step.slug, variantSlug: step.variant_slug },
        search: {
          objective: slug,
          revision: saved.enrollment!.objective_revision_id,
          target: saved.enrollment!.target_guide_base_id ?? undefined,
        },
        state: { analyticsSource: "resume" },
      });
    }
  }

  return (
    <section
      aria-label="Objective progress"
      className="mb-6 space-y-3 rounded-lg border p-4"
    >
      <p className="font-semibold">
        {state.counts.read} / {state.counts.included} steps read
      </p>
      {state.counts.requested > 0 && (
        <p className="text-sm">
          {state.counts.requested} guides not yet written.
        </p>
      )}
      {state.counts.unavailable > 0 && (
        <p className="text-sm">
          {state.counts.unavailable} guides unavailable.
        </p>
      )}
      {position && (
        <p className="text-sm">
          Continue: {position.title ?? "Unavailable guide"}
        </p>
      )}
      {enrollment &&
        enrollment.objective_revision_id !== state.current_revision_id && (
          <p className="text-sm">
            A newer version is available.{" "}
            <Link
              to="/objectives/$slug/revisions/$revisionId"
              params={{ slug, revisionId: enrollment.objective_revision_id }}
              className="underline"
            >
              View your version
            </Link>
          </p>
        )}
      {enrollment?.last_completed_at && enrollment.completed_revision_id && (
        <p className="text-sm text-muted-foreground">
          <Link
            to="/objectives/$slug/revisions/$revisionId"
            params={{ slug, revisionId: enrollment.completed_revision_id }}
            className="underline"
          >
            {complete ? "Completed" : "Last completed"}{" "}
            {new Date(enrollment.last_completed_at).toLocaleDateString()}
          </Link>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {!enrollment && (
          <Button
            size="lg"
            className="btn-pri"
            disabled={mutation.pending || progress.loading}
            onClick={() => void act("start")}
          >
            Start objective
          </Button>
        )}
        {enrollment && !complete && (
          <Button
            size="lg"
            className="btn-pri"
            disabled={!canResume || mutation.pending || progress.loading}
            onClick={() => void act("resume")}
          >
            Resume objective
          </Button>
        )}
        {enrollment && !complete && (
          <Button
            variant="outline"
            size="lg"
            className="btn-sec"
            disabled={!ready || mutation.pending || progress.loading}
            onClick={() => void act("complete")}
          >
            Complete objective
          </Button>
        )}
        {complete && (
          <Button
            variant="outline"
            size="lg"
            className="btn-sec"
            disabled={mutation.pending || progress.loading}
            onClick={() => void act("reopen")}
          >
            Reopen objective
          </Button>
        )}
      </div>
      {!canResume && (
        <p className="text-sm text-muted-foreground">
          No guides are available to read.
        </p>
      )}
      {enrollment && !complete && !ready && (
        <p className="text-sm text-muted-foreground">
          All steps must be available and read to complete.
        </p>
      )}
      <LearningFailure error={progress.error} refresh={progress.refresh} />
      <LearningFailure error={mutation.error} refresh={progress.refresh} />
    </section>
  );
}
