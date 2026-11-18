import type { LearningObjective, LearningStep } from "@/lib/api/learning";

export function canCompleteObjective(counts: LearningObjective["counts"]) {
  return (
    counts.included > 0 &&
    counts.read === counts.included &&
    counts.requested === 0 &&
    counts.unavailable === 0
  );
}

export function resumeStep(
  state: LearningObjective
): (LearningStep & { slug: string; variant_slug: string }) | undefined {
  const openable = state.steps.filter(
    (step): step is LearningStep & { slug: string; variant_slug: string } =>
      (step.state === "read" || step.state === "unread") &&
      step.guide_id !== null &&
      step.slug !== null &&
      step.variant_slug !== null
  );

  return (
    openable.find(
      (step) => step.guide_base_id === state.enrollment?.position_guide_base_id
    ) ??
    openable.find((step) => step.state === "unread") ??
    openable[0]
  );
}
