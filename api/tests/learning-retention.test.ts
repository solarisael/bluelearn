import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  analyticsEventsResponseSchema,
  analyticsReportResponseSchema,
} from "@bluelearn/schemas";
import app from "../src/index";
import { admin, auth, jsonAuth, makeUser } from "./helpers";
import { grantRole } from "./factories/identity";
import { createPublishedGuide } from "./factories/guides";
import { createPublishedObjective } from "./factories/objectives";
import {
  collectionEnv,
  databaseRows,
  observationWindow,
  utcDay,
} from "./learning-helpers";

const users: string[] = [];
const events: string[] = [];
const windows: number[] = [];
const bases: string[] = [];
const dimensions: string[] = [];
const objectives: string[] = [];
afterEach(async () => {
  for (const id of users.splice(0)) {
    const linked = await databaseRows(
      `analytics_events?user_id=eq.${id}&select=event_id`
    );
    events.push(...linked.map((row) => z.string().parse(row.event_id)));
    await admin.from("profiles").delete().eq("id", id).throwOnError();
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  if (events.length) {
    const ids = [...new Set(events.splice(0))].join(",");
    await databaseRows(`analytics_events?event_id=in.(${ids})`, "DELETE");
    await databaseRows(
      `analytics_event_receipts?event_id=in.(${ids})`,
      "DELETE"
    );
  }
  for (const id of bases.splice(0))
    await databaseRows(`analytics_daily?guide_base_id=eq.${id}`, "DELETE");
  for (const id of objectives.splice(0))
    await databaseRows(`analytics_daily?objective_id=eq.${id}`, "DELETE");
  for (const key of dimensions.splice(0))
    await databaseRows(
      `analytics_daily?dimension_key=eq.${encodeURIComponent(key)}`,
      "DELETE"
    );
  for (const id of windows.splice(0))
    await databaseRows(`analytics_collection_windows?id=eq.${id}`, "DELETE");
});

async function schedule() {
  await app.scheduled(
    {
      cron: "*/5 * * * *",
      scheduledTime: Date.now(),
      noRetry: () => {
        throw new Error("Retention must not disable scheduled retries");
      },
    },
    collectionEnv
  );
}

describe("The real scheduled learning-retention entry point", () => {
  it("rolls up before raw deletion, expires private visits, and remains idempotent", async () => {
    const user = await makeUser();
    users.push(user.userId);
    await grantRole(user.userId, "admin");
    const item = await createPublishedGuide();
    bases.push(item.base.id);
    const objective = await createPublishedObjective(user.userId, item);
    objectives.push(objective.objective.id);
    const oldDay = utcDay(-91);
    windows.push(await observationWindow(utcDay(-100), utcDay(-1)));
    const event = {
      event_id: crypto.randomUUID(),
      name: "reader_opened",
      guide_id: item.guide.id,
      revision_id: item.revision.id,
      guide_base_id: item.base.id,
      source: "direct",
    };
    events.push(event.event_id);
    const accepted = await app.request(
      "/analytics/events",
      jsonAuth(user.token, "POST", { events: [event] }),
      collectionEnv
    );
    expect(
      analyticsEventsResponseSchema.parse(await accepted.json()).accepted
    ).toBe(1);
    const duplicate = await app.request(
      "/analytics/events",
      jsonAuth(user.token, "POST", { events: [event] }),
      collectionEnv
    );
    expect(
      analyticsEventsResponseSchema.parse(await duplicate.json())
    ).toMatchObject({ accepted: 0, duplicates: 1 });
    await databaseRows(
      `analytics_events?event_id=eq.${event.event_id}`,
      "PATCH",
      { received_at: `${oldDay}T12:00:00Z` }
    );
    await databaseRows(
      `analytics_event_receipts?event_id=eq.${event.event_id}`,
      "PATCH",
      { received_at: `${oldDay}T12:00:00Z` }
    );
    await app.request(
      "/learning/history",
      jsonAuth(user.token, "POST", {
        event_id: crypto.randomUUID(),
        guide_id: item.guide.id,
        revision_id: item.revision.id,
        source: "direct",
      }),
      collectionEnv
    );
    await databaseRows(`learning_visits?user_id=eq.${user.userId}`, "PATCH", {
      visited_at: `${oldDay}T12:00:00Z`,
    });
    await databaseRows(
      `learning_visit_receipts?user_id=eq.${user.userId}`,
      "PATCH",
      { received_at: `${oldDay}T12:00:00Z` }
    );
    await app.request(
      `/learning/reads/${item.guide.id}`,
      jsonAuth(user.token, "PUT", {
        revision_id: item.revision.id,
        read: true,
      }),
      collectionEnv
    );
    await app.request(
      `/learning/objectives/${objective.objective.slug}/start`,
      jsonAuth(user.token, "POST", {
        event_id: crypto.randomUUID(),
        expected_revision_id: objective.revision.id,
      }),
      collectionEnv
    );
    await databaseRows(
      `learning_mutation_receipts?user_id=eq.${user.userId}`,
      "PATCH",
      { received_at: `${oldDay}T12:00:00Z` }
    );
    const expiredDimension = `retention-${crypto.randomUUID()}`;
    dimensions.push(expiredDimension);
    await databaseRows("analytics_daily", "POST", {
      day: utcDay(-366),
      dimension_key: expiredDimension,
      name: "reader_opened",
      guide_base_id: item.base.id,
      event_count: 1,
      anonymous_count: 0,
    });

    await schedule();
    expect(
      await databaseRows(`analytics_events?event_id=eq.${event.event_id}`)
    ).toEqual([]);
    expect(
      await databaseRows(
        `analytics_event_receipts?event_id=eq.${event.event_id}`
      )
    ).toEqual([]);
    expect(
      await databaseRows(`learning_visits?user_id=eq.${user.userId}`)
    ).toEqual([]);
    expect(
      await databaseRows(`learning_visit_receipts?user_id=eq.${user.userId}`)
    ).toEqual([]);
    expect(
      await databaseRows(`learning_mutation_receipts?user_id=eq.${user.userId}`)
    ).toEqual([]);
    expect(
      await databaseRows(`learning_reads?user_id=eq.${user.userId}`)
    ).toHaveLength(1);
    expect(
      await databaseRows(`learning_enrollments?user_id=eq.${user.userId}`)
    ).toHaveLength(1);
    expect(
      await databaseRows(`analytics_daily?dimension_key=eq.${expiredDimension}`)
    ).toEqual([]);
    const rolled = await databaseRows(
      `analytics_daily?guide_base_id=eq.${item.base.id}&day=eq.${oldDay}&name=eq.reader_opened`
    );
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.event_count).toBe(1);
    expect(rolled[0]).not.toHaveProperty("user_id");

    await schedule();
    const repeated = await databaseRows(
      `analytics_daily?guide_base_id=eq.${item.base.id}&day=eq.${oldDay}&name=eq.reader_opened`
    );
    expect(repeated[0]?.event_count).toBe(1);
    const replayedAt = Date.now();
    const retry = await app.request(
      "/analytics/events",
      jsonAuth(user.token, "POST", { events: [event] }),
      collectionEnv
    );
    expect(
      analyticsEventsResponseSchema.parse(await retry.json())
    ).toMatchObject({ accepted: 1, duplicates: 0 });
    const replay = await databaseRows(
      `analytics_events?event_id=eq.${event.event_id}`
    );
    expect(
      Date.parse(z.string().parse(replay[0]?.received_at))
    ).toBeGreaterThanOrEqual(replayedAt - 1000);
    const response = await app.request(
      `/analytics/report?from=${oldDay}&to=${oldDay}`,
      auth(user.token),
      collectionEnv
    );
    expect(response.status).toBe(200);
    const report = analyticsReportResponseSchema.parse(await response.json());
    expect(
      report.guides.find((row) => row.guide_base_id === item.base.id)
    ).toMatchObject({ opens: 1, signed_in_readers: null });
    expect(report.daily[0]?.reader_opens).toBe(1);
    expect(
      report.sections
        .flatMap((section) => section.metrics)
        .find((metric) => metric.key === "signed_in_readers")?.value
    ).toBeNull();
    const removed = await app.request(
      "/me",
      { method: "DELETE", ...auth(user.token) },
      collectionEnv
    );
    expect(removed.status).toBe(204);
    users.splice(users.indexOf(user.userId), 1);
    const preserved = await databaseRows(
      `analytics_daily?guide_base_id=eq.${item.base.id}&day=eq.${oldDay}&name=eq.reader_opened`
    );
    expect(preserved[0]?.event_count).toBe(1);
    expect(
      await databaseRows(`analytics_events?user_id=eq.${user.userId}`)
    ).toEqual([]);
  });
});
