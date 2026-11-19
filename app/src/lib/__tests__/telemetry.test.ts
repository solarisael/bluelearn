// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Telemetry from "@/lib/telemetry";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

let telemetry: typeof Telemetry;
let requests: Array<Request>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", "https://analytics.test");
  vi.stubGlobal("crypto", webcrypto);
  requests = [];
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null } });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        Response.json({ accepted: 1, duplicates: 0, enabled: true })
      );
    })
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  telemetry = await import("@/lib/telemetry");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("client analytics delivery", () => {
  it("sends the closed wire representation with a generated UUID", async () => {
    expect(
      telemetry.trackEvent({ name: "search_submitted", source: "search" })
    ).toBeUndefined();
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("https://analytics.test/analytics/events");
    const body = await requests[0].json();

    expect(body).toEqual({
      events: [
        {
          name: "search_submitted",
          source: "search",
          event_id: expect.any(String),
        },
      ],
    });
    expect(body.events[0].event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requests[0].headers.has("Authorization")).toBe(false);
  });

  it("waits for the resolved session before sending account attribution", async () => {
    let resolveSession!: (value: {
      data: { session: { access_token: string } };
    }) => void;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      })
    );
    const eventId = telemetry.newAnalyticsEventId();
    telemetry.trackEvent({
      event_id: eventId,
      name: "reader_opened",
      source: "direct",
    });
    expect(requests).toHaveLength(0);

    resolveSession({ data: { session: { access_token: "resolved-token" } } });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0].headers.get("Authorization")).toBe(
      "Bearer resolved-token"
    );
    expect((await requests[0].json()).events[0].event_id).toBe(eventId);
  });

  it("refuses server events, unknown payloads, raw queries, URLs, and unbounded categories", () => {
    const invalid = [
      { name: "objective_completed" },
      { name: "search_submitted", query: "private search" },
      { name: "search_submitted", url: "https://private.test/token" },
      { name: "reader_opened", guide_id: "https://private.test/guide" },
      { name: "reader_load_failed", error_category: "private exception" },
      { name: "search_submitted", result_count: -1 },
    ];

    for (const event of invalid)
      telemetry.trackEvent(event as Telemetry.ClientAnalyticsEvent);

    expect(requests).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      "Analytics delivery diagnostic:",
      "invalid_event"
    );
  });

  it("does not throw or retry when authentication or delivery fails", async () => {
    getSession.mockRejectedValue(new Error("private exception text"));

    expect(() =>
      telemetry.trackEvent({ name: "search_submitted" })
    ).not.toThrow();
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "Analytics delivery diagnostic:",
        "delivery_failed"
      )
    );
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      "private exception text"
    );
  });

  it("bounds outstanding delivery without retaining a retry queue", async () => {
    let resolveSession!: (value: { data: { session: null } }) => void;
    const session = new Promise((resolve) => {
      resolveSession = resolve;
    });
    getSession.mockReturnValue(session);

    for (let index = 0; index < 25; index += 1) {
      telemetry.trackEvent({ name: "search_submitted" });
    }

    expect(getSession).toHaveBeenCalledTimes(20);
    expect(console.warn).toHaveBeenCalledTimes(3);
    resolveSession({ data: { session: null } });
    await vi.waitFor(() => expect(requests).toHaveLength(20));
  });

  it("uses direct only when source attribution is absent or invalid", () => {
    expect(telemetry.analyticsSource()).toBe("direct");
    expect(telemetry.analyticsSource("resume")).toBe("resume");
    expect(telemetry.analyticsSource("https://private.test" as "direct")).toBe(
      "direct"
    );
  });
  it("generates an RFC 4122 UUIDv4 when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    });

    const id = telemetry.newAnalyticsEventId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("sends identity-free save diagnostics without expired auth", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "expired-token" } },
    });

    telemetry.trackEvent({
      name: "progress_save_failed",
      source: "objective",
      guide_id: "00000000-0000-4000-8000-000000000001",
      revision_id: "00000000-0000-4000-8000-000000000002",
      objective_id: "00000000-0000-4000-8000-000000000003",
      objective_revision_id: "00000000-0000-4000-8000-000000000004",
      error_category: "unavailable",
      exception_text: "private error contents",
    } as Telemetry.ClientAnalyticsEvent);
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0].headers.has("Authorization")).toBe(false);
    expect(await requests[0].json()).toEqual({
      events: [
        {
          name: "progress_save_failed",
          source: "objective",
          error_category: "unavailable",
          event_id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
          ),
        },
      ],
    });
  });
});
