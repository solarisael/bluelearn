import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  learningPreferencesSchema,
  learningHistoryResponseSchema,
  learningReadsResponseSchema,
  learningReadResponseSchema,
  learningObjectiveStateSchema,
  learningObjectivesResponseSchema,
  publicLearningResponseSchema,
  guideSchema,
} from "@bluelearn/schemas";
import app from "../src/index";
import { admin, auth, env, insert, jsonAuth, makeUser } from "./helpers";
import { getUsername } from "./factories/identity";
import {
  createGuide,
  createGuideRevision,
  createPublishedGuide,
} from "./factories/guides";
import {
  addObjectiveNode,
  createObjectiveRevision,
  createPublishedObjective,
} from "./factories/objectives";
import {
  collectionEnv,
  databaseRequest,
  databaseRows,
} from "./learning-helpers";

const users: string[] = [];
async function learner() {
  const value = await makeUser();
  users.push(value.userId);
  return value;
}
async function objectiveAction(
  token: string,
  slug: string,
  action: string,
  revision: string,
  extra = {}
) {
  return app.request(
    `/learning/objectives/${slug}/${action}`,
    jsonAuth(token, "POST", {
      event_id: crypto.randomUUID(),
      expected_revision_id: revision,
      ...extra,
    }),
    collectionEnv
  );
}
async function read(
  token: string,
  guide: string,
  revision: string,
  desired = true
) {
  return app.request(
    `/learning/reads/${guide}`,
    jsonAuth(token, "PUT", { revision_id: revision, read: desired }),
    collectionEnv
  );
}
afterEach(async () => {
  for (const id of users.splice(0)) {
    const linked = await databaseRows(
      `analytics_events?user_id=eq.${id}&select=event_id`
    );
    const eventIds = linked.map((row) => z.string().parse(row.event_id));
    await admin.from("profiles").delete().eq("id", id).throwOnError();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
    if (eventIds.length)
      await databaseRows(
        `analytics_event_receipts?event_id=in.(${eventIds.join(",")})`,
        "DELETE"
      );
  }
});

describe("Private learning through the real API and Supabase", () => {
  it("refuses anonymous private state and direct writes that bypass validated transitions", async () => {
    for (const path of [
      "/learning/preferences",
      "/learning/history",
      "/learning/reads?guide_ids=",
      "/learning/objectives",
      "/learning/objectives/missing",
    ]) {
      expect((await app.request(path, {}, env)).status).toBe(401);
    }
    const owner = await learner();
    const stranger = await learner();
    const guide = await createPublishedGuide();
    const objective = await createPublishedObjective(owner.userId, guide);
    expect(
      (await read(owner.token, guide.guide.id, guide.revision.id)).status
    ).toBe(200);
    const hidden = await databaseRequest(
      "learning_reads?select=*&user_id=eq." + owner.userId,
      "GET",
      undefined,
      stranger.token
    );
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual([]);

    const bypass = await databaseRequest(
      "learning_enrollments",
      "POST",
      {
        user_id: owner.userId,
        objective_id: objective.objective.id,
        objective_revision_id: objective.revision.id,
        completed_at: new Date().toISOString(),
      },
      owner.token
    );
    expect(bypass.status).toBe(403);
    const rawEvents = await databaseRequest(
      "analytics_events?select=*",
      "GET",
      undefined,
      owner.token
    );
    expect(rawEvents.status).toBe(403);
    const forged = await databaseRequest(
      "rpc/analytics_ingest",
      "POST",
      {
        p_events: [
          { event_id: crypto.randomUUID(), name: "objective_completed" },
        ],
        p_enabled: true,
        p_server: true,
      },
      owner.token
    );
    expect(forged.status).toBe(403);
  });

  it("returns defaults without enrollment side effects and exposes canonical revision/base identities", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    const objective = await createPublishedObjective(user.userId, guide);
    const response = await app.request(
      `/learning/objectives/${objective.objective.slug}`,
      auth(user.token),
      env
    );
    expect(response.status).toBe(200);
    const state = learningObjectiveStateSchema.parse(await response.json());
    expect(state.enrollment).toBeNull();
    expect(state.counts).toEqual({
      included: 1,
      read: 0,
      requested: 0,
      unavailable: 0,
    });
    expect(state.steps[0]).toMatchObject({
      guide_id: guide.guide.id,
      variant_slug: guide.guide.slug,
      state: "unread",
    });
    expect(
      await databaseRows(`learning_enrollments?user_id=eq.${user.userId}`)
    ).toEqual([]);
    expect(
      await databaseRows(`learning_preferences?user_id=eq.${user.userId}`)
    ).toEqual([]);
    const prefs = await app.request(
      "/learning/preferences",
      auth(user.token),
      env
    );
    expect(learningPreferencesSchema.parse(await prefs.json())).toEqual({
      history_paused: false,
      show_completed_objectives: false,
    });
    const canonical = await app.request(`/guides/${guide.base.slug}`, {}, env);
    const body = guideSchema.parse(await canonical.json());
    expect(body.guide_base_id).toBe(guide.base.id);
    expect(body.revision_id).toBe(guide.revision.id);
  });

  it("deduplicates visits, validates context, paginates, and clears history without removing reads", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    const other = await createPublishedGuide();
    const objective = await createPublishedObjective(user.userId, guide);
    const input = {
      event_id: crypto.randomUUID(),
      guide_id: guide.guide.id,
      revision_id: guide.revision.id,
      source: "objective",
      objective_id: objective.objective.id,
      objective_revision_id: objective.revision.id,
      target_guide_base_id: guide.base.id,
    };
    const record = () =>
      app.request(
        "/learning/history",
        jsonAuth(user.token, "POST", input),
        env
      );
    expect(await (await record()).json()).toEqual({ recorded: true });
    expect(await (await record()).json()).toEqual({ recorded: false });
    const invalid = await app.request(
      "/learning/history",
      jsonAuth(user.token, "POST", {
        ...input,
        event_id: crypto.randomUUID(),
        guide_id: other.guide.id,
        revision_id: other.revision.id,
      }),
      env
    );
    expect(invalid.status).toBe(400);
    await read(user.token, guide.guide.id, guide.revision.id);
    const history = learningHistoryResponseSchema.parse(
      await (
        await app.request(
          "/learning/history?page=1&limit=1",
          auth(user.token),
          env
        )
      ).json()
    );
    expect(history.total).toBe(1);
    expect(history.visits[0]).toMatchObject({
      guide_id: guide.guide.id,
      revision_id: guide.revision.id,
      variant_slug: "main",
      available: true,
    });
    expect(
      (
        await app.request(
          "/learning/history?page=2&limit=1",
          auth(user.token),
          env
        )
      ).status
    ).toBe(200);
    expect(
      await (
        await app.request(
          `/learning/history/${guide.guide.id}`,
          { method: "DELETE", ...auth(user.token) },
          env
        )
      ).json()
    ).toEqual({ ok: true });
    expect(await (await record()).json()).toEqual({ recorded: false });
    expect(
      await (
        await app.request(
          "/learning/history",
          { method: "DELETE", ...auth(user.token) },
          env
        )
      ).json()
    ).toEqual({ ok: true });
    const marks = learningReadsResponseSchema.parse(
      await (
        await app.request(
          `/learning/reads?guide_ids=${guide.guide.id}`,
          auth(user.token),
          env
        )
      ).json()
    );
    expect(marks.reads).toHaveLength(1);
  });

  it("keeps removal controls but hides unavailable history metadata", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    await app.request(
      "/learning/history",
      jsonAuth(user.token, "POST", {
        event_id: crypto.randomUUID(),
        guide_id: guide.guide.id,
        revision_id: guide.revision.id,
        source: "direct",
      }),
      env
    );
    await admin
      .from("guides")
      .update({ status: "archived" })
      .eq("id", guide.guide.id)
      .throwOnError();
    const history = learningHistoryResponseSchema.parse(
      await (
        await app.request("/learning/history", auth(user.token), env)
      ).json()
    );
    expect(history.visits[0]).toMatchObject({
      available: false,
      title: null,
      slug: null,
      variant_slug: null,
    });
    expect(
      (
        await app.request(
          `/learning/history/${guide.guide.id}`,
          { method: "DELETE", ...auth(user.token) },
          env
        )
      ).status
    ).toBe(200);
  });

  it("preserves old read marks, rejects stale writes, and bounds batches", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    const [first, repeated] = await Promise.all([
      read(user.token, guide.guide.id, guide.revision.id),
      read(user.token, guide.guide.id, guide.revision.id),
    ]);
    const changes = await Promise.all(
      [first, repeated].map(async (response) =>
        learningReadResponseSchema.parse(await response.json())
      )
    );
    expect(changes.map((state) => state.changed).sort()).toEqual([false, true]);
    const newer = await createGuideRevision(guide.guide.id, {
      approved_at: new Date().toISOString(),
    });
    await admin
      .from("guides")
      .update({ current_revision_id: newer.id })
      .eq("id", guide.guide.id)
      .throwOnError();
    const reads = learningReadsResponseSchema.parse(
      await (
        await app.request(
          `/learning/reads?guide_ids=${guide.guide.id}`,
          auth(user.token),
          env
        )
      ).json()
    );
    expect(reads.reads[0]).toMatchObject({
      revision_id: guide.revision.id,
      has_newer_revision: true,
    });
    expect(
      (await read(user.token, guide.guide.id, guide.revision.id, false)).status
    ).toBe(409);
    expect(
      learningReadResponseSchema.parse(
        await (await read(user.token, guide.guide.id, newer.id, false)).json()
      )
    ).toEqual({ read: null, changed: true });
    expect(
      learningReadResponseSchema.parse(
        await (await read(user.token, guide.guide.id, newer.id, false)).json()
      )
    ).toEqual({ read: null, changed: false });
    const tooMany = Array.from({ length: 101 }, () => crypto.randomUUID()).join(
      ","
    );
    expect(
      (
        await app.request(
          `/learning/reads?guide_ids=${tooMany}`,
          auth(user.token),
          env
        )
      ).status
    ).toBe(400);
  });

  it("counts only pinned variants and refuses unread, requested, or unavailable included steps", async () => {
    const user = await learner();
    const canonical = await createPublishedGuide();
    const pinned = await createGuide(canonical.base.id, {
      status: "published",
      slug: "pinned",
    });
    const revision = await createGuideRevision(pinned.id, {
      approved_at: new Date().toISOString(),
    });
    await admin
      .from("guides")
      .update({ current_revision_id: revision.id })
      .eq("id", pinned.id)
      .throwOnError();
    const objective = await createPublishedObjective(user.userId, {
      base: canonical.base,
      guide: pinned,
    });
    const skipped = await createPublishedGuide();
    await addObjectiveNode(
      objective.revision.id,
      skipped.base.id,
      skipped.guide.id,
      { is_included: false }
    );
    await read(user.token, canonical.guide.id, canonical.revision.id);
    const start = await objectiveAction(
      user.token,
      objective.objective.slug!,
      "start",
      objective.revision.id,
      { target_guide_base_id: canonical.base.id }
    );
    expect(start.status).toBe(200);
    const state = learningObjectiveStateSchema.parse(await start.json());
    expect(state.counts).toEqual({
      included: 1,
      read: 0,
      requested: 0,
      unavailable: 0,
    });
    expect(state.steps[0]?.variant_slug).toBe("pinned");
    expect(
      (
        await objectiveAction(
          user.token,
          objective.objective.slug!,
          "complete",
          objective.revision.id
        )
      ).status
    ).toBe(409);
    await read(user.token, pinned.id, revision.id);
    const newer = await createGuideRevision(pinned.id, {
      approved_at: new Date().toISOString(),
    });
    await admin
      .from("guides")
      .update({ current_revision_id: newer.id })
      .eq("id", pinned.id)
      .throwOnError();
    const completionInput = {
      event_id: crypto.randomUUID(),
      expected_revision_id: objective.revision.id,
    };
    const completions = await Promise.all(
      [0, 1].map(() =>
        app.request(
          `/learning/objectives/${objective.objective.slug}/complete`,
          jsonAuth(user.token, "POST", completionInput),
          collectionEnv
        )
      )
    );
    for (const complete of completions) {
      expect(complete.status).toBe(200);
      expect(
        learningObjectiveStateSchema.parse(await complete.json()).steps[0]
          ?.has_newer_revision
      ).toBe(true);
    }
    expect(
      await databaseRows(
        `analytics_events?user_id=eq.${user.userId}&objective_id=eq.${objective.objective.id}&name=eq.objective_completed`
      )
    ).toHaveLength(1);

    const requestedObjective = await createPublishedObjective(
      user.userId,
      canonical
    );
    await insert("objective_revision_nodes", {
      revision_id: requestedObjective.revision.id,
      title: "Missing step",
      summary: "Requested prerequisite",
    });
    await objectiveAction(
      user.token,
      requestedObjective.objective.slug!,
      "start",
      requestedObjective.revision.id
    );
    expect(
      (
        await objectiveAction(
          user.token,
          requestedObjective.objective.slug!,
          "complete",
          requestedObjective.revision.id
        )
      ).status
    ).toBe(409);
    const requested = learningObjectiveStateSchema.parse(
      await (
        await app.request(
          `/learning/objectives/${requestedObjective.objective.slug}`,
          auth(user.token),
          env
        )
      ).json()
    );
    expect(requested.counts.requested).toBe(1);
    expect(requested.counts.included).toBe(2);

    const unavailableObjective = await createPublishedObjective(
      user.userId,
      canonical
    );
    await objectiveAction(
      user.token,
      unavailableObjective.objective.slug!,
      "start",
      unavailableObjective.revision.id
    );
    await admin
      .from("guides")
      .update({ status: "archived" })
      .eq("id", canonical.guide.id)
      .throwOnError();
    expect(
      (
        await objectiveAction(
          user.token,
          unavailableObjective.objective.slug!,
          "complete",
          unavailableObjective.revision.id
        )
      ).status
    ).toBe(409);
    const unavailable = learningObjectiveStateSchema.parse(
      await (
        await app.request(
          `/learning/objectives/${unavailableObjective.objective.slug}`,
          auth(user.token),
          env
        )
      ).json()
    );
    expect(unavailable.counts.unavailable).toBe(1);
  });

  it("validates enrollment membership and deduplicates concurrent action retries independently of telemetry", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    const other = await createPublishedGuide();
    const objective = await createPublishedObjective(user.userId, guide);
    const position = (body: unknown) =>
      app.request(
        `/learning/objectives/${objective.objective.slug}/position`,
        jsonAuth(user.token, "PATCH", body),
        collectionEnv
      );
    expect(
      (
        await position({
          expected_revision_id: objective.revision.id,
          guide_base_id: guide.base.id,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await objectiveAction(
          user.token,
          objective.objective.slug!,
          "start",
          objective.revision.id,
          { target_guide_base_id: other.base.id }
        )
      ).status
    ).toBe(400);
    await objectiveAction(
      user.token,
      objective.objective.slug!,
      "start",
      objective.revision.id
    );
    expect(
      (
        await position({
          expected_revision_id: crypto.randomUUID(),
          guide_base_id: guide.base.id,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await position({
          expected_revision_id: objective.revision.id,
          guide_base_id: other.base.id,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await position({
          expected_revision_id: objective.revision.id,
          guide_base_id: guide.base.id,
        })
      ).status
    ).toBe(200);
    const input = {
      event_id: crypto.randomUUID(),
      expected_revision_id: objective.revision.id,
    };
    const responses = await Promise.all(
      [0, 1].map(() =>
        app.request(
          `/learning/objectives/${objective.objective.slug}/resume`,
          jsonAuth(user.token, "POST", input),
          collectionEnv
        )
      )
    );
    const states = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        return learningObjectiveStateSchema.parse(await response.json());
      })
    );
    expect(states[0]?.enrollment?.last_resumed_at).toBe(
      states[1]?.enrollment?.last_resumed_at
    );
    expect(
      await databaseRows(
        `analytics_events?user_id=eq.${user.userId}&name=eq.objective_resumed`
      )
    ).toHaveLength(1);
    const changedPayload = await app.request(
      `/learning/objectives/${objective.objective.slug}/resume`,
      jsonAuth(user.token, "POST", {
        ...input,
        target_guide_base_id: guide.base.id,
      }),
      collectionEnv
    );
    expect(changedPayload.status).toBe(409);
  });

  it("reopens on the current revision and preserves the last historical achievement", async () => {
    const user = await learner();
    const oldGuide = await createPublishedGuide();
    const newGuide = await createPublishedGuide();
    const objective = await createPublishedObjective(user.userId, oldGuide, {
      title: "Original achievement",
    });
    await objectiveAction(
      user.token,
      objective.objective.slug!,
      "start",
      objective.revision.id
    );
    await app.request(
      `/learning/objectives/${objective.objective.slug}/position`,
      jsonAuth(user.token, "PATCH", {
        expected_revision_id: objective.revision.id,
        guide_base_id: oldGuide.base.id,
      }),
      env
    );
    await read(user.token, oldGuide.guide.id, oldGuide.revision.id);
    const completed = learningObjectiveStateSchema.parse(
      await (
        await objectiveAction(
          user.token,
          objective.objective.slug!,
          "complete",
          objective.revision.id
        )
      ).json()
    );
    const newer = await createObjectiveRevision(objective.objective.id, {
      title: "Current title",
      status: "published",
      published_at: new Date().toISOString(),
    });
    await addObjectiveNode(newer.id, newGuide.base.id, newGuide.guide.id, {
      is_target: true,
    });
    await admin
      .from("objectives")
      .update({ current_revision_id: newer.id })
      .eq("id", objective.objective.id)
      .throwOnError();
    const beforeReopen = learningObjectiveStateSchema.parse(
      await (
        await app.request(
          `/learning/objectives/${objective.objective.slug}`,
          auth(user.token),
          env
        )
      ).json()
    );
    expect(beforeReopen.enrollment?.objective_revision_id).toBe(
      objective.revision.id
    );
    expect(beforeReopen.enrollment?.completed_at).toBe(
      completed.enrollment?.completed_at
    );
    const reopened = learningObjectiveStateSchema.parse(
      await (
        await objectiveAction(
          user.token,
          objective.objective.slug!,
          "reopen",
          newer.id,
          { target_guide_base_id: newGuide.base.id }
        )
      ).json()
    );
    expect(reopened.enrollment).toMatchObject({
      objective_revision_id: newer.id,
      completed_at: null,
      position_guide_base_id: null,
      completed_revision_id: objective.revision.id,
      last_completed_at: completed.enrollment?.last_completed_at,
    });
    const username = await getUsername(user.userId);
    expect(
      publicLearningResponseSchema.parse(
        await (
          await app.request(`/learning/public/${username}`, {}, env)
        ).json()
      ).objectives
    ).toEqual([]);
    expect(
      (
        await app.request(
          "/learning/preferences",
          jsonAuth(user.token, "PATCH", { show_completed_objectives: true }),
          env
        )
      ).status
    ).toBe(200);
    const publicState = publicLearningResponseSchema.parse(
      await (await app.request(`/learning/public/${username}`, {}, env)).json()
    );
    expect(publicState.objectives).toEqual([
      {
        slug: objective.objective.slug,
        title: "Original achievement",
        completed_revision_id: objective.revision.id,
        completed_at: completed.enrollment?.last_completed_at,
      },
    ]);
    const list = learningObjectivesResponseSchema.parse(
      await (
        await app.request(
          "/learning/objectives?page=1&limit=1",
          auth(user.token),
          env
        )
      ).json()
    );
    expect(list.total).toBe(1);
    expect(list.objectives[0]?.enrollment?.objective_revision_id).toBe(
      newer.id
    );
  });

  it("keeps a successful progress save when real telemetry delivery is refused", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
    const response = await app.request(
      `/learning/reads/${guide.guide.id}`,
      jsonAuth(user.token, "PUT", {
        revision_id: guide.revision.id,
        read: true,
      }),
      { ...collectionEnv, SUPABASE_SECRET_KEY: "invalid-service-key" }
    );
    expect(response.status).toBe(200);
    expect(
      learningReadResponseSchema.parse(await response.json()).changed
    ).toBe(true);
    const stored = await databaseRows(
      `learning_reads?user_id=eq.${user.userId}&guide_id=eq.${guide.guide.id}`
    );
    expect(stored).toHaveLength(1);
  });
});
