import { describe, expect, it } from "vitest";
import type { LearningObjective, LearningStep } from "@/lib/api/learning";
import { canCompleteObjective, resumeStep } from "@/lib/learningProgress";

const step = (
  id: string,
  fields: Partial<LearningStep> = {}
): LearningStep => ({
  guide_base_id: `base-${id}`,
  guide_id: `pinned-${id}`,
  variant_slug: `variant-${id}`,
  slug: id,
  title: id,
  revision_id: `revision-${id}`,
  state: "unread",
  has_newer_revision: false,
  is_target: false,
  ...fields,
});

const objective = (
  steps: Array<LearningStep>,
  position: string | null = null
): LearningObjective => ({
  objective_id: "objective",
  slug: "proofs",
  title: "Proofs",
  current_revision_id: "new-objective-revision",
  enrollment: {
    objective_revision_id: "enrolled-revision",
    target_guide_base_id: "base-target",
    position_guide_base_id: position,
    started_at: "2026-11-16T12:00:00Z",
    last_resumed_at: null,
    completed_at: null,
    completed_revision_id: null,
    last_completed_at: null,
  },
  steps,
  counts: { included: 2, read: 0, requested: 0, unavailable: 0 },
});

describe("objective completion eligibility", () => {
  it("requires every included step and no blocked steps", () => {
    expect(
      canCompleteObjective({
        included: 2,
        read: 2,
        requested: 0,
        unavailable: 0,
      })
    ).toBe(true);

    for (const counts of [
      { included: 2, read: 1, requested: 0, unavailable: 0 },
      { included: 2, read: 2, requested: 1, unavailable: 0 },
      { included: 2, read: 2, requested: 0, unavailable: 1 },
      { included: 0, read: 0, requested: 0, unavailable: 0 },
    ]) {
      expect(canCompleteObjective(counts)).toBe(false);
    }
  });
});

describe("objective resume position", () => {
  it("keeps the saved topic and its pinned variant before unread suggestions", () => {
    const saved = step("saved", { state: "read", has_newer_revision: true });
    const result = resumeStep(objective([step("first"), saved], "base-saved"));

    expect(result).toBe(saved);
    expect(result?.variant_slug).toBe("variant-saved");
    expect(result?.has_newer_revision).toBe(true);
  });

  it("uses an available unread step when the saved guide becomes unavailable", () => {
    const unread = step("next");
    const result = resumeStep(
      objective(
        [
          step("saved", { state: "unavailable" }),
          step("request", {
            state: "requested",
            guide_id: null,
            variant_slug: null,
          }),
          unread,
        ],
        "base-saved"
      )
    );

    expect(result).toBe(unread);
  });

  it("never replaces a missing pinned variant with a canonical link", () => {
    expect(
      resumeStep(
        objective([
          step("gone", { variant_slug: null }),
          step("request", { state: "requested" }),
          step("private", { state: "unavailable" }),
        ])
      )
    ).toBeUndefined();
  });
});
