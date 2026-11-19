import { z } from "zod";
import { env } from "./helpers";

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
