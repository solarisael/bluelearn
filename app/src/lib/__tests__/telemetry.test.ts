// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Telemetry from "@/lib/telemetry";

let telemetry: typeof Telemetry;

beforeEach(async () => {
  vi.resetModules();
  telemetry = await import("@/lib/telemetry");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client analytics delivery", () => {
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
});
