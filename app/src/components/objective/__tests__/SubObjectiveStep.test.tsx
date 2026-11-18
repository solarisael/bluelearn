// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  ObjectiveSnapshot,
  ObjectiveSnapshotNode,
} from "@bluelearn/schemas";
import { buildObjectiveFlow } from "@/lib/objectiveSnapshot";
import { SubObjectiveStep } from "@/components/objective/SubObjectiveStep";
import { renderWithRouter } from "@/components/objective/__tests__/renderWithRouter";

const Stepper = {
  Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
};

const node = (
  id: string,
  fields: Partial<ObjectiveSnapshotNode>
): ObjectiveSnapshotNode => ({
  id,
  guide_base_id: null,
  guide_id: fields.guide_base_id ? `variant-${id}` : null,
  variant_slug: fields.guide_base_id ? `pinned-${id}` : null,
  guide_revision_id: fields.guide_base_id ? `revision-${id}` : null,
  slug: null,
  title: null,
  summary: null,
  request_id: null,
  is_target: false,
  is_included: true,
  is_featured: false,
  target_position: null,
  note: null,
  ...fields,
});

const snapshot: ObjectiveSnapshot = {
  nodes: [
    node("guide", {
      guide_base_id: "base-guide",
      slug: "loops",
      title: "Loops",
    }),
    node("request-a", { title: "Loop invariants", summary: "Reasoning" }),
    node("request-b", { title: "Termination proofs", is_target: true }),
  ],
  orders: [
    { target_node_id: "request-b", node_id: "guide", position: 0 },
    { target_node_id: "request-b", node_id: "request-a", position: 1 },
  ],
  projected_edges: [],
  raw_edges: [],
  drawn_edges: [],
};

describe("SubObjectiveStep", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("links only the guide and lists each request once, as a request", async () => {
    const consoleError = vi.spyOn(console, "error");
    const { targets } = buildObjectiveFlow(snapshot, []);

    await renderWithRouter(
      <SubObjectiveStep
        Stepper={Stepper}
        target={targets[0]}
        objective={{ slug: "proofs", title: "Proofs" }}
      />
    );

    const links = screen.queryAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/guides/loops/pinned-guide?objective=proofs&target=request-b",
    ]);
    expect(
      screen.getByRole("heading", { name: "Loop invariants" })
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Termination proofs" })
    ).toBeTruthy();
    expect(screen.getAllByText("Guide request")).toHaveLength(2);
    expect(screen.getByText("Reasoning")).toBeTruthy();

    const keyWarnings = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes("same key")
    );
    expect(keyWarnings).toHaveLength(0);
  });

  it("anchors each openable guide so a return can scroll to it", async () => {
    const { targets } = buildObjectiveFlow(snapshot, []);

    const { container } = await renderWithRouter(
      <SubObjectiveStep
        Stepper={Stepper}
        target={targets[0]}
        objective={{ slug: "proofs", title: "Proofs" }}
      />
    );

    const anchored = container.querySelectorAll("li[id]");
    expect(Array.from(anchored, (item) => item.id)).toEqual(["guide-loops"]);
  });
});
