import { describe, expect, it } from "vitest";
import app from "../src/index";
import { admin, auth, env, jsonAuth, makeUser } from "./helpers";
import { grantRole } from "./factories/identity";
import { createPublishedGuide } from "./factories/guides";
import { createPrerequisite } from "./factories/graph";
import {
  createObjective,
  createObjectiveRevision,
} from "./factories/objectives";
import { expectToMatchSpec } from "./openapi";

type Snapshot = {
  nodes: Array<{
    id: string;
    guide_base_id: string | null;
    title: string | null;
    summary: string | null;
    request_id: string | null;
  }>;
  objective_node_id: string | null;
  drawn_edges: Array<{ from_node_id: string; to_node_id: string }>;
};

const request = {
  title: "Needed prerequisite",
  summary: "Explain the missing prerequisite",
};

async function curatorDraft() {
  const curator = await makeUser();
  await grantRole(curator.userId, "curator");
  const objective = await createObjective(curator.userId);
  const revision = await createObjectiveRevision(objective.id, {
    author_id: curator.userId,
    status: "draft",
  });
  return { curator, revision };
}

function patch(revisionId: string, token: string, body: unknown) {
  return app.request(
    `/objective-revisions/${revisionId}`,
    jsonAuth(token, "PATCH", body),
    env
  );
}

async function snapshotOf(revisionId: string, token: string) {
  const res = await app.request(
    `/objective-revisions/${revisionId}`,
    auth(token),
    env
  );
  expect(res.status).toBe(200);
  await expectToMatchSpec(res, "GET", "/objective-revisions/{id}");
  const body = (await res.json()) as { snapshot: Snapshot };
  return body.snapshot;
}

// A draft whose target guide was seeded by `targets`, so its node already has a
// server id the client does not know.
async function draftWithTarget() {
  const { curator, revision } = await curatorDraft();
  const goal = await createPublishedGuide();
  const seeded = await patch(revision.id, curator.token, {
    targets: [{ guide_base_id: goal.base.id }],
  });
  expect(seeded.status).toBe(200);
  const [goalNode] = (await snapshotOf(revision.id, curator.token)).nodes;
  return { curator, revision, goal, goalNode };
}

describe("PATCH /objective-revisions/{id} graph", () => {
  it("stores a request node and its edge under the guide node's server id", async () => {
    const { curator, revision, goal, goalNode } = await draftWithTarget();
    const goalClientId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    const res = await patch(revision.id, curator.token, {
      graph: {
        nodes: [
          { id: goalClientId, guide_base_id: goal.base.id },
          { id: requestId, ...request },
        ],
        edges: [{ from_node_id: goalClientId, to_node_id: requestId }],
      },
    });
    expect(res.status).toBe(200);
    await expectToMatchSpec(res, "PATCH", "/objective-revisions/{id}");

    const snapshot = await snapshotOf(revision.id, curator.token);
    expect(snapshot.nodes).toContainEqual(
      expect.objectContaining({
        id: requestId,
        guide_base_id: null,
        title: request.title,
        summary: request.summary,
        request_id: null,
      })
    );
    expect(snapshot.drawn_edges).toEqual([
      { from_node_id: goalNode.id, to_node_id: requestId },
    ]);
    expect(snapshot.nodes.map((n) => n.id)).not.toContain(goalClientId);
  });

  it("removes a request node the graph no longer holds, with its edge", async () => {
    const { curator, revision, goal, goalNode } = await draftWithTarget();
    const goalClientId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    await patch(revision.id, curator.token, {
      graph: {
        nodes: [
          { id: goalClientId, guide_base_id: goal.base.id },
          { id: requestId, ...request },
        ],
        edges: [{ from_node_id: goalClientId, to_node_id: requestId }],
      },
    });
    const res = await patch(revision.id, curator.token, {
      graph: {
        nodes: [{ id: goalClientId, guide_base_id: goal.base.id }],
        edges: [],
      },
    });
    expect(res.status).toBe(200);

    const snapshot = await snapshotOf(revision.id, curator.token);
    expect(snapshot.nodes.map((n) => n.id)).toEqual([goalNode.id]);
    expect(snapshot.drawn_edges).toEqual([]);
  });

  it("keeps a guide node placed by hand through a later targets save", async () => {
    const { curator, revision, goal } = await draftWithTarget();
    const placed = await createPublishedGuide();
    const graph = (bases: string[]) => ({
      graph: {
        nodes: bases.map((id) => ({
          id: crypto.randomUUID(),
          guide_base_id: id,
        })),
        edges: [],
      },
    });

    await patch(
      revision.id,
      curator.token,
      graph([goal.base.id, placed.base.id])
    );
    const retargeted = await patch(revision.id, curator.token, {
      targets: [{ guide_base_id: goal.base.id }],
    });
    expect(retargeted.status).toBe(200);

    const kept = await snapshotOf(revision.id, curator.token);
    expect(kept.nodes.map((n) => n.guide_base_id)).toContain(placed.base.id);

    // The graph, not the closure, is what takes it out again.
    await patch(revision.id, curator.token, graph([goal.base.id]));
    const dropped = await snapshotOf(revision.id, curator.token);
    expect(dropped.nodes.map((n) => n.guide_base_id)).toEqual([goal.base.id]);
  });

  it("keeps the targets' prerequisites through a graph save that omits them", async () => {
    const { curator, revision } = await curatorDraft();
    const prereq = await createPublishedGuide();
    const goal = await createPublishedGuide();
    await createPrerequisite(prereq.base.id, goal.base.id);
    await patch(revision.id, curator.token, {
      targets: [{ guide_base_id: goal.base.id }],
    });

    const res = await patch(revision.id, curator.token, {
      graph: {
        nodes: [{ id: crypto.randomUUID(), guide_base_id: goal.base.id }],
        edges: [],
      },
    });
    expect(res.status).toBe(200);

    const bases = (await snapshotOf(revision.id, curator.token)).nodes.map(
      (n) => n.guide_base_id
    );
    expect(bases.sort()).toEqual([goal.base.id, prereq.base.id].sort());
  });

  it("400s an edge naming a node outside the graph and writes nothing", async () => {
    const { curator, revision, goal } = await draftWithTarget();
    const goalClientId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const nodes = [
      { id: goalClientId, guide_base_id: goal.base.id },
      { id: requestId, ...request },
    ];
    const edge = { from_node_id: goalClientId, to_node_id: requestId };

    const refused = await patch(revision.id, curator.token, {
      graph: {
        nodes,
        edges: [
          edge,
          { from_node_id: crypto.randomUUID(), to_node_id: requestId },
        ],
      },
    });
    expect(refused.status).toBe(400);
    await expectToMatchSpec(refused, "PATCH", "/objective-revisions/{id}");

    const { data: edgeRows } = await admin
      .from("objective_revision_edges")
      .select("from_node_id")
      .eq("revision_id", revision.id)
      .throwOnError();
    expect(edgeRows).toEqual([]);
    const { data: requestRows } = await admin
      .from("objective_revision_nodes")
      .select("id")
      .eq("id", requestId)
      .throwOnError();
    expect(requestRows).toEqual([]);

    const accepted = await patch(revision.id, curator.token, {
      graph: { nodes, edges: [edge] },
    });
    expect(accepted.status).toBe(200);
  });

  it("403s a non-curator author and accepts the same body once they curate", async () => {
    const author = await makeUser();
    const objective = await createObjective(author.userId);
    const revision = await createObjectiveRevision(objective.id, {
      author_id: author.userId,
      status: "draft",
    });
    const body = {
      graph: { nodes: [{ id: crypto.randomUUID(), ...request }], edges: [] },
    };

    const refused = await patch(revision.id, author.token, body);
    expect(refused.status).toBe(403);
    await expectToMatchSpec(refused, "PATCH", "/objective-revisions/{id}");

    await grantRole(author.userId, "curator");
    const accepted = await patch(revision.id, author.token, body);
    expect(accepted.status).toBe(200);
  });
});

describe("PATCH /objective-revisions/{id} graph objective node", () => {
  async function objectiveRows(revisionId: string) {
    const { data } = await admin
      .from("objective_revision_nodes")
      .select("id")
      .eq("revision_id", revisionId)
      .eq("is_objective", true)
      .throwOnError();
    return data.map((r) => r.id);
  }

  it("stores edges into and out of the objective under one server id, kept across saves", async () => {
    const { curator, revision, goal, goalNode } = await draftWithTarget();
    const goalClientId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const graph = (objectiveClientId: string) => ({
      graph: {
        nodes: [
          { id: goalClientId, guide_base_id: goal.base.id },
          { id: objectiveClientId, kind: "objective" },
          { id: requestId, ...request },
        ],
        edges: [
          { from_node_id: goalClientId, to_node_id: objectiveClientId },
          { from_node_id: objectiveClientId, to_node_id: requestId },
        ],
      },
    });

    const placeholder = crypto.randomUUID();
    const first = await patch(revision.id, curator.token, graph(placeholder));
    expect(first.status).toBe(200);
    await expectToMatchSpec(first, "PATCH", "/objective-revisions/{id}");
    const { objective_node_id: storedId } = (await first.json()) as {
      objective_node_id: string;
    };
    expect(storedId).not.toBe(placeholder);

    const snapshot = await snapshotOf(revision.id, curator.token);
    expect(snapshot.objective_node_id).toBe(storedId);
    expect(snapshot.nodes.map((n) => n.id)).not.toContain(storedId);
    expect(snapshot.drawn_edges).toEqual(
      expect.arrayContaining([
        { from_node_id: goalNode.id, to_node_id: storedId },
        { from_node_id: storedId, to_node_id: requestId },
      ])
    );
    expect(snapshot.drawn_edges).toHaveLength(2);

    // a second client name for it, as after a reload from local storage
    const second = await patch(
      revision.id,
      curator.token,
      graph(crypto.randomUUID())
    );
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as { objective_node_id: string }).objective_node_id
    ).toBe(storedId);
    expect(await objectiveRows(revision.id)).toEqual([storedId]);

    // a body without it keeps the row and drops only its edges
    const without = await patch(revision.id, curator.token, {
      graph: {
        nodes: [{ id: goalClientId, guide_base_id: goal.base.id }],
        edges: [],
      },
    });
    expect(without.status).toBe(200);
    const after = await snapshotOf(revision.id, curator.token);
    expect(after.objective_node_id).toBe(storedId);
    expect(after.drawn_edges).toEqual([]);
  });

  it("400s an edge from the objective to an id outside the graph, and a second objective node", async () => {
    const { curator, revision, goal } = await draftWithTarget();
    const goalClientId = crypto.randomUUID();
    const objectiveId = crypto.randomUUID();
    const nodes = [
      { id: goalClientId, guide_base_id: goal.base.id },
      { id: objectiveId, kind: "objective" },
    ];

    const dangling = await patch(revision.id, curator.token, {
      graph: {
        nodes,
        edges: [{ from_node_id: objectiveId, to_node_id: crypto.randomUUID() }],
      },
    });
    expect(dangling.status).toBe(400);

    const doubled = await patch(revision.id, curator.token, {
      graph: {
        nodes: [...nodes, { id: crypto.randomUUID(), kind: "objective" }],
        edges: [],
      },
    });
    expect(doubled.status).toBe(400);
    expect(await objectiveRows(revision.id)).toEqual([]);

    const accepted = await patch(revision.id, curator.token, {
      graph: {
        nodes,
        edges: [{ from_node_id: goalClientId, to_node_id: objectiveId }],
      },
    });
    expect(accepted.status).toBe(200);
    expect(await objectiveRows(revision.id)).toHaveLength(1);
  });
});

describe("project_objective_edges beside the objective row", () => {
  it("still bridges across a guide the revision skips", async () => {
    const { revision } = await curatorDraft();
    const [before, skipped, after] = await Promise.all([
      createPublishedGuide(),
      createPublishedGuide(),
      createPublishedGuide(),
    ]);
    await createPrerequisite(before.base.id, skipped.base.id);
    await createPrerequisite(skipped.base.id, after.base.id);
    await admin
      .from("objective_revision_nodes")
      .insert(
        [
          {
            revision_id: revision.id,
            guide_base_id: before.base.id,
            guide_id: before.guide.id,
          },
          {
            revision_id: revision.id,
            guide_base_id: after.base.id,
            guide_id: after.guide.id,
          },
          { revision_id: revision.id, is_objective: true },
        ],
        { defaultToNull: false }
      )
      .throwOnError();

    const { data } = await admin
      .rpc("project_objective_edges", { p_revision_id: revision.id })
      .throwOnError();
    expect(data).toEqual([
      { from_guide_base_id: before.base.id, to_guide_base_id: after.base.id },
    ]);
  });
});
