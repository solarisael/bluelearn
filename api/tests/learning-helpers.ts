import { z } from "zod";
import { env } from "./helpers";

export const collectionEnv = { ...env, ANALYTICS_COLLECTION_ENABLED: "true" };

export function utcDay(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function databaseRequest(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string
) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: token ? env.SUPABASE_PUBLISHABLE_KEY : env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${token ?? env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function databaseRows(
  path: string,
  method = "GET",
  body?: unknown
) {
  const response = await databaseRequest(path, method, body);

  if (!response.ok)
    throw new Error(
      `Database fixture failed (${response.status}): ${await response.text()}`
    );
  if (response.status === 204) return [];

  return z
    .array(z.record(z.string(), z.unknown()))
    .parse(await response.json());
}

export async function observationWindow(from: string, to: string) {
  const rows = await databaseRows("analytics_collection_windows", "POST", {
    started_at: `${from}T00:00:00Z`,
    ended_at: `${to}T23:59:59.999Z`,
  });
  return z.number().parse(rows[0]?.id);
}
