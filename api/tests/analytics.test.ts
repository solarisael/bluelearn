import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  analyticsEventsResponseSchema,
  analyticsReportResponseSchema,
  learningReadResponseSchema,
} from "@bluelearn/schemas";
import type { AnalyticsClientEvent, AnalyticsReport } from "@bluelearn/schemas";
import app from "../src/index";
import { admin, auth, env, jsonAuth, makeUser } from "./helpers";
import { grantRole } from "./factories/identity";
import { createGuideRevision, createPublishedGuide } from "./factories/guides";
import { createPublishedObjective } from "./factories/objectives";
import { createReviewCase, createReviewPanel } from "./factories/reviews";
import {
  collectionEnv,
  databaseRequest,
  databaseRows,
  observationWindow,
  utcDay,
} from "./learning-helpers";

const users: string[] = [];
const events: string[] = [];
const windows: number[] = [];
const bases: string[] = [];
const cases: string[] = [];
async function account(role?: "admin" | "moderator") {
  const value = await makeUser();
  users.push(value.userId);
  if (role) await grantRole(value.userId, role);
  return value;
}
async function guide() {
  const value = await createPublishedGuide();
  bases.push(value.base.id);
  return value;
}
async function observe(from: string, to: string) {
  windows.push(await observationWindow(from, to));
}
async function ingest(input: AnalyticsClientEvent[], token?: string) {
  events.push(...input.map((event) => event.event_id));
  const init = token
    ? jsonAuth(token, "POST", { events: input })
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: input }),
      };
  return app.request("/analytics/events", init, collectionEnv);
}
async function report(token: string, from: string, to = from) {
  const response = await app.request(
    `/analytics/report?from=${from}&to=${to}`,
    auth(token),
    collectionEnv
  );
  expect(response.status).toBe(200);
  return analyticsReportResponseSchema.parse(await response.json());
}
function metric(value: AnalyticsReport, key: string) {
  const found = value.sections
    .flatMap((section) => section.metrics)
    .find((item) => item.key === key);
  expect(found, key).toBeDefined();
  return found!;
}
async function moveEvent(id: string, day: string) {
  await databaseRows(`analytics_events?event_id=eq.${id}`, "PATCH", {
    received_at: `${day}T12:00:00Z`,
  });
}

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
  const ids = [...new Set(events.splice(0))];
  if (ids.length) {
    await databaseRows(
      `analytics_events?event_id=in.(${ids.join(",")})`,
      "DELETE"
    );
    await databaseRows(
      `analytics_event_receipts?event_id=in.(${ids.join(",")})`,
      "DELETE"
    );
  }
  for (const id of windows.splice(0))
    await databaseRows(`analytics_collection_windows?id=eq.${id}`, "DELETE");
  for (const id of bases.splice(0))
    await databaseRows(`analytics_daily?guide_base_id=eq.${id}`, "DELETE");
  for (const id of cases.splice(0)) {
    await admin.from("review_panels").delete().eq("case_id", id).throwOnError();
    await admin.from("review_cases").delete().eq("id", id).throwOnError();
  }
});

describe("Analytics ingestion and private identity", () => {
  it("defaults collection off, refuses unknown fields and server events, and bounds batches", async () => {
    const event = {
      event_id: crypto.randomUUID(),
      name: "search_submitted",
      result_count: 2,
    };
    const disabled = await app.request(
      "/analytics/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [event] }),
      },
      { ...env, ANALYTICS_COLLECTION_ENABLED: undefined }
    );
    expect(disabled.status).toBe(200);
    expect(analyticsEventsResponseSchema.parse(await disabled.json())).toEqual({
      accepted: 0,
      duplicates: 0,
      enabled: false,
    });
    expect(
      await databaseRows(
        `analytics_event_receipts?event_id=eq.${event.event_id}`
      )
    ).toEqual([]);
    for (const invalid of [
      { ...event, name: "objective_completed" },
      { ...event, search_text: "private query" },
      { ...event, user_id: crypto.randomUUID() },
      { ...event, received_at: "2020-01-01T00:00:00Z" },
      { ...event, error_category: "exception text" },
      { ...event, source: "external-url" },
    ]) {
      const response = await app.request(
        "/analytics/events",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [invalid] }),
        },
        collectionEnv
      );
      expect(response.status).toBe(400);
    }
    const tooMany = await app.request(
      "/analytics/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: Array.from({ length: 21 }, () => event),
        }),
      },
      collectionEnv
    );
    expect(tooMany.status).toBe(400);
  });

  it("deduplicates concurrent retries durably and validates published identifier relationships", async () => {
    const first = await guide();
    const second = await guide();
    const event: AnalyticsClientEvent = {
      event_id: crypto.randomUUID(),
      name: "reader_opened",
      source: "guide",
      guide_id: first.guide.id,
      revision_id: first.revision.id,
      guide_base_id: first.base.id,
    };
    const responses = await Promise.all([ingest([event]), ingest([event])]);
    const results = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        return analyticsEventsResponseSchema.parse(await response.json());
      })
    );
    expect(results.reduce((sum, item) => sum + item.accepted, 0)).toBe(1);
    expect(results.reduce((sum, item) => sum + item.duplicates, 0)).toBe(1);
    expect(
      (
        await ingest([
          {
            ...event,
            event_id: crypto.randomUUID(),
            guide_base_id: second.base.id,
          },
        ])
      ).status
    ).toBe(400);
    expect(
      (
        await ingest([
          {
            ...event,
            event_id: crypto.randomUUID(),
            guide_id: second.guide.id,
            guide_base_id: second.base.id,
          },
        ])
      ).status
    ).toBe(409);
    const newer = await createGuideRevision(first.guide.id, {
      approved_at: new Date().toISOString(),
    });
    await admin
      .from("guides")
      .update({ current_revision_id: newer.id })
      .eq("id", first.guide.id)
      .throwOnError();
    expect(
      (await ingest([{ ...event, event_id: crypto.randomUUID() }])).status
    ).toBe(409);
    await admin
      .from("guides")
      .update({ status: "archived" })
      .eq("id", second.guide.id)
      .throwOnError();
    expect(
      (
        await ingest([
          {
            event_id: crypto.randomUUID(),
            name: "search_result_selected",
            entity_type: "guide",
            guide_base_id: second.base.id,
          },
        ])
      ).status
    ).toBe(400);
  });
  it("accepts revision-free variant selections and identity-free save diagnostics", async () => {
    const first = await guide();
    const variant: AnalyticsClientEvent = {
      event_id: crypto.randomUUID(),
      name: "variant_selected",
      source: "guide",
      guide_id: first.guide.id,
    };
    const variantResponse = await ingest([variant]);
    expect(variantResponse.status).toBe(200);
    expect(
      (await databaseRows(
        `analytics_events?event_id=eq.${variant.event_id}&select=guide_id,revision_id`
      ))[0]
    ).toEqual({ guide_id: first.guide.id, revision_id: null });

    const stale = await guide();
    const newerRevision = await createGuideRevision(stale.guide.id, {
      approved_at: new Date().toISOString(),
    });
    await admin
      .from("guides")
      .update({ current_revision_id: newerRevision.id })
      .eq("id", stale.guide.id)
      .throwOnError();
    const unpublished = await guide();
    await admin
      .from("guides")
      .update({ status: "archived" })
      .eq("id", unpublished.guide.id)
      .throwOnError();

    for (let index = 0; index < 2; index += 1) {
      const diagnostic: AnalyticsClientEvent = {
        event_id: crypto.randomUUID(),
        name: "progress_save_failed",
        source: "guide",
        error_category: "conflict",
      };
      const response = await ingest([diagnostic]);
      expect(response.status).toBe(200);
      expect(
        (await databaseRows(
          `analytics_events?event_id=eq.${diagnostic.event_id}&select=guide_id,revision_id,guide_base_id,objective_id,objective_revision_id,error_category,source,was_anonymous`
        ))[0]
      ).toEqual({
        guide_id: null,
        revision_id: null,
        guide_base_id: null,
        objective_id: null,
        objective_revision_id: null,
        error_category: "conflict",
        source: "guide",
        was_anonymous: true,
      });
    }

    const invalidToken = await app.request(
      "/analytics/events",
      jsonAuth("expired-or-invalid-token", "POST", {
        events: [
          {
            event_id: crypto.randomUUID(),
            name: "progress_save_failed",
            source: "guide",
            error_category: "network",
          },
        ],
      }),
      collectionEnv
    );
    expect(invalidToken.status).toBe(401);

    expect(
      (
        await ingest([
          {
            event_id: crypto.randomUUID(),
            name: "progress_save_failed",
            source: "guide",
            error_category: "network",
            guide_id: stale.guide.id,
          },
        ])
      ).status
    ).toBe(400);
  });


  it("rechecks pause preferences, unlinks prior telemetry, and still saves explicit progress", async () => {
    const user = await account();
    const item = await guide();
    const before: AnalyticsClientEvent = {
      event_id: crypto.randomUUID(),
      name: "reader_opened",
      guide_id: item.guide.id,
      revision_id: item.revision.id,
    };
    expect((await ingest([before], user.token)).status).toBe(200);
    expect(
      (await databaseRows(`analytics_events?event_id=eq.${before.event_id}`))[0]
        ?.user_id
    ).toBe(user.userId);
    const paused = await app.request(
      "/learning/preferences",
      jsonAuth(user.token, "PATCH", { history_paused: true }),
      collectionEnv
    );
    expect(paused.status).toBe(200);
    expect(
      (await databaseRows(`analytics_events?event_id=eq.${before.event_id}`))[0]
        ?.user_id
    ).toBeNull();
    const after = { ...before, event_id: crypto.randomUUID() };
    expect((await ingest([after], user.token)).status).toBe(200);
    expect(
      (await databaseRows(`analytics_events?event_id=eq.${after.event_id}`))[0]
        ?.user_id
    ).toBeNull();
    const visit = await app.request(
      "/learning/history",
      jsonAuth(user.token, "POST", {
        event_id: crypto.randomUUID(),
        guide_id: item.guide.id,
        revision_id: item.revision.id,
        source: "direct",
      }),
      collectionEnv
    );
    expect(await visit.json()).toEqual({ recorded: false });
    expect(
      await databaseRows(`learning_visits?user_id=eq.${user.userId}`)
    ).toEqual([]);
    const read = await app.request(
      `/learning/reads/${item.guide.id}`,
      jsonAuth(user.token, "PUT", {
        revision_id: item.revision.id,
        read: true,
      }),
      collectionEnv
    );
    expect(learningReadResponseSchema.parse(await read.json()).changed).toBe(
      true
    );
    const transitions = await databaseRows(
      `analytics_events?guide_id=eq.${item.guide.id}&name=eq.guide_marked_read`
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.user_id).toBeNull();
    events.push(z.string().parse(transitions[0]?.event_id));
    expect(
      await databaseRows(`learning_reads?user_id=eq.${user.userId}`)
    ).toHaveLength(1);
  });

  it("deletes private learning and account-linked telemetry through the account removal endpoint", async () => {
    const user = await account();
    const item = await guide();
    const objective = await createPublishedObjective(user.userId, item);
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
    const linked = await databaseRows(
      `analytics_events?user_id=eq.${user.userId}&select=event_id`
    );
    events.push(...linked.map((row) => z.string().parse(row.event_id)));
    expect(linked.length).toBeGreaterThan(0);
    const deleted = await app.request(
      "/me",
      { method: "DELETE", ...auth(user.token) },
      collectionEnv
    );
    expect(deleted.status).toBe(204);
    users.splice(users.indexOf(user.userId), 1);
    for (const table of [
      "learning_preferences",
      "learning_visits",
      "learning_visit_receipts",
      "learning_reads",
      "learning_enrollments",
      "learning_mutation_receipts",
      "analytics_events",
    ]) {
      expect(await databaseRows(`${table}?user_id=eq.${user.userId}`)).toEqual(
        []
      );
    }
  });
});

describe("Admin reports with real event windows", () => {
  it("refuses anonymous and non-admin reports at both API and database boundaries", async () => {
    const user = await account("moderator");
    const query = `/analytics/report?from=${utcDay(-1)}&to=${utcDay(-1)}`;
    expect((await app.request(query, {}, collectionEnv)).status).toBe(401);
    expect(
      (await app.request(query, auth(user.token), collectionEnv)).status
    ).toBe(403);
    const direct = await databaseRequest(
      "rpc/analytics_report",
      "POST",
      { p_from: utcDay(-1), p_to: utcDay(-1) },
      user.token
    );
    expect(direct.status).toBe(403);
  });

  it("validates UTC calendar ranges and leaves unavailable observation null instead of zero", async () => {
    const user = await account("admin");
    for (const range of [
      "from=2026-02-30&to=2026-03-01",
      "from=2026-04-02&to=2026-04-01",
      "from=2024-01-01&to=2025-01-01",
    ]) {
      expect(
        (
          await app.request(
            `/analytics/report?${range}`,
            auth(user.token),
            collectionEnv
          )
        ).status
      ).toBe(400);
    }
    const unavailable = await report(user.token, utcDay(-400));
    expect(metric(unavailable, "reader_opened").value).toBeNull();
    expect(metric(unavailable, "reader_opened").reason).toBeTruthy();
    expect(unavailable.daily[0]?.reader_opens).toBeNull();
    expect(unavailable.guides).toEqual([]);
    expect(unavailable.range.timezone).toBe("UTC");
    expect(unavailable.collection_started_at).not.toBeNull();
  });

  it("shows partial activity across first-day collection and gaps while withholding account counts", async () => {
    const director = await account("admin");
    const item = await guide();
    const firstDay = utcDay(-70);
    const gapDay = utcDay(-69);
    const lastDay = utcDay(-68);
    const firstWindow = await observationWindow(firstDay, firstDay);
    windows.push(firstWindow);
    await databaseRows(`analytics_collection_windows?id=eq.${firstWindow}`, "PATCH", {
      started_at: `${firstDay}T12:00:00Z`,
      ended_at: `${firstDay}T18:00:00Z`,
    });
    await observe(lastDay, utcDay(-67));
    for (let index = 0; index < 5; index += 1) {
      const user = await account();
      const event: AnalyticsClientEvent = {
        event_id: crypto.randomUUID(),
        name: "reader_opened",
        guide_id: item.guide.id,
        revision_id: item.revision.id,
      };
      expect((await ingest([event], user.token)).status).toBe(200);
      await moveEvent(event.event_id, firstDay);
    }
    const lastEvent: AnalyticsClientEvent = {
      event_id: crypto.randomUUID(),
      name: "reader_opened",
      guide_id: item.guide.id,
      revision_id: item.revision.id,
    };
    expect((await ingest([lastEvent])).status).toBe(200);
    await moveEvent(lastEvent.event_id, lastDay);

    const first = await report(director.token, firstDay);
    expect(first.observation.status).toBe("partial");
    expect(metric(first, "reader_opened").value).toBe(5);
    expect(metric(first, "signed_in_readers").value).toBeNull();
    expect(first.daily[0]?.observation).toBe("partial");
    expect(first.daily[0]?.reader_opens).toBe(5);

    const combined = await report(director.token, firstDay, lastDay);
    expect(combined.observation.status).toBe("partial");
    expect(metric(combined, "reader_opened").value).toBe(6);
    expect(metric(combined, "signed_in_readers").value).toBeNull();
    expect(combined.guides.find((row) => row.guide_base_id === item.base.id)).toMatchObject({
      opens: 6,
      signed_in_readers: null,
    });
    expect(combined.daily.find((row) => row.day === gapDay)).toMatchObject({
      observation: "unavailable",
      reader_opens: null,
    });
    const complete = await report(director.token, lastDay);
    expect(complete.observation.status).toBe("complete");
    expect(metric(complete, "reader_opened").value).toBe(1);
    expect(metric(complete, "objective_started").value).toBe(0);
  });

  it("suppresses small account groups without hiding event totals or inventing anonymous visitors", async () => {
    const director = await account("admin");
    const item = await guide();
    const day = utcDay(-4);
    await observe(day, utcDay(-1));
    for (let index = 0; index < 4; index++) {
      const user = await account();
      const event: AnalyticsClientEvent = {
        event_id: crypto.randomUUID(),
        name: "reader_opened",
        source: "search",
        guide_id: item.guide.id,
        revision_id: item.revision.id,
      };
      expect((await ingest([event], user.token)).status).toBe(200);
      await moveEvent(event.event_id, day);
    }
    const anonymous: AnalyticsClientEvent = {
      event_id: crypto.randomUUID(),
      name: "reader_opened",
      source: "history",
      guide_id: item.guide.id,
      revision_id: item.revision.id,
    };
    await ingest([anonymous]);
    await moveEvent(anonymous.event_id, day);
    const result = await report(director.token, day);
    const row = result.guides.find(
      (value) => value.guide_base_id === item.base.id
    );
    expect(row).toMatchObject({ opens: 5, signed_in_readers: null });
    expect(metric(result, "anonymous_reader_opens").value).toBe(1);
    expect(metric(result, "signed_in_readers").value).toBeNull();
    expect(JSON.stringify(result)).not.toContain("user_id");
  });

  it("uses range-level distinct accounts and complete matured daily cohorts", async () => {
    const director = await account("admin");
    const item = await guide();
    const cohort = utcDay(-40);
    await observe(utcDay(-41), utcDay(-1));
    for (let index = 0; index < 5; index++) {
      const user = await account();
      const first: AnalyticsClientEvent = {
        event_id: crypto.randomUUID(),
        name: "reader_opened",
        guide_id: item.guide.id,
        revision_id: item.revision.id,
      };
      const returned: AnalyticsClientEvent = {
        ...first,
        event_id: crypto.randomUUID(),
      };
      await ingest([first, returned], user.token);
      await moveEvent(first.event_id, cohort);
      await moveEvent(returned.event_id, index < 4 ? utcDay(-35) : utcDay(-10));
    }
    const result = await report(director.token, cohort, utcDay(-35));
    expect(metric(result, "signed_in_readers").value).toBe(5);
    expect(metric(result, "return_7_days").value).toBe(80);
    expect(metric(result, "return_30_days").value).toBe(100);
    expect(metric(result, "return_7_days").definition).toContain(
      "repeated daily cohorts"
    );
    const immature = await report(director.token, utcDay(-3));
    expect(metric(immature, "return_7_days").value).toBeNull();
    const window = windows.pop();
    await databaseRows(
      `analytics_collection_windows?id=eq.${window}`,
      "DELETE"
    );
    const missingWindow = await report(director.token, cohort);
    expect(metric(missingWindow, "return_7_days").value).toBeNull();
  });

  it("counts closed panels and final terminal turnaround, not individual votes or case creation", async () => {
    const director = await account("admin");
    const day = utcDay(-2);
    const reviewCase = await createReviewCase(director.userId, {
      status: "approved",
      created_at: `${utcDay(-10)}T12:00:00Z`,
    });
    cases.push(reviewCase.id);
    await createReviewPanel(reviewCase.id, {
      opened_at: `${utcDay(-9)}T12:00:00Z`,
      closed_at: `${utcDay(-3)}T12:00:00Z`,
      outcome: "rejected",
    });
    await createReviewPanel(reviewCase.id, {
      opened_at: `${utcDay(-3)}T12:00:00Z`,
      closed_at: `${day}T12:00:00Z`,
      outcome: "approved",
    });
    const before = await report(director.token, day);
    expect(metric(before, "decisions").value).toBe(1);
    expect(metric(before, "review_turnaround_days").value).toBe(8);
    expect(metric(before, "fulfilled_requests").definition).toContain(
      "Currently"
    );
    expect(metric(before, "overdue_assignments").definition).toContain(
      "not a historical"
    );
    expect(metric(before, "reader_opened").value).toBeNull();
  });
});
