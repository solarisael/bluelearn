import { hc } from "hono/client";
import type { AppType } from "api";
import type { InferRequestType, InferResponseType } from "hono/client";
import { client } from "@/lib/api/apiClient";
import { assertOk } from "@/lib/api/apiHelpers";

const anonymousAnalytics = hc<AppType>(import.meta.env.VITE_API_BASE);

const analytics = client.analytics;

export type AnalyticsEvent = InferRequestType<
  typeof analytics.events.$post
>["json"]["events"][number];

export type AnalyticsReport = InferResponseType<
  typeof analytics.report.$get,
  200
>;

export type AnalyticsRange = { from: string; to: string };

export async function postAnalyticsEvents(
  events: Array<AnalyticsEvent>,
  { omitAuth = false }: { omitAuth?: boolean } = {}
) {
  const endpoint = omitAuth
    ? anonymousAnalytics.analytics.events
    : analytics.events;
  const response = await endpoint.$post({ json: { events } });

  await assertOk(response);

  return response.json();
}

export async function fetchAnalyticsReport(
  range: AnalyticsRange,
  { signal }: { signal?: AbortSignal } = {}
) {
  const response = await analytics.report.$get(
    { query: range },
    { init: { signal } }
  );

  await assertOk(response);

  return response.json();
}
