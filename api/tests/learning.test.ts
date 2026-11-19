import { afterEach, describe, expect, it } from "vitest";
import {
  learningPreferencesSchema,
  learningHistoryResponseSchema,
  learningReadsResponseSchema,
  learningReadResponseSchema,
  guideSchema,
} from "@bluelearn/schemas";
import app from "../src/index";
import { admin, auth, env, jsonAuth, makeUser } from "./helpers";
import { createGuideRevision, createPublishedGuide } from "./factories/guides";
import { createPublishedObjective } from "./factories/objectives";
import { databaseRequest, databaseRows } from "./learning-helpers";

const users: string[] = [];
async function learner() {
  const value = await makeUser();
  users.push(value.userId);
  return value;
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
    env
  );
}
afterEach(async () => {
  for (const id of users.splice(0)) {
    await admin.from("profiles").delete().eq("id", id).throwOnError();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
});

describe("Private learning through the real API and Supabase", () => {
  it("refuses anonymous private state", async () => {
    for (const path of [
      "/learning/preferences",
      "/learning/history",
      "/learning/reads?guide_ids=",
    ]) {
      expect((await app.request(path, {}, env)).status).toBe(401);
    }
    const owner = await learner();
    const stranger = await learner();
    const guide = await createPublishedGuide();
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
  });

  it("returns defaults and exposes canonical revision/base identities", async () => {
    const user = await learner();
    const guide = await createPublishedGuide();
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
});
