import type { InferRequestType } from "hono/client";
import { client } from "@/lib/api/apiClient";
import { assertOk } from "@/lib/api/apiHelpers";

const learning = client.learning;
type FetchOptions = { signal?: AbortSignal };
type Page = { page?: number; limit?: number };

export async function getLearningPreferences({ signal }: FetchOptions = {}) {
  const res = await learning.preferences.$get({}, { init: { signal } });
  if (!res.ok) return assertOk(res) as Promise<never>;

  return res.json();
}

export async function updateLearningPreferences(
  json: InferRequestType<typeof learning.preferences.$patch>["json"]
) {
  const res = await learning.preferences.$patch({ json });
  if (!res.ok) return assertOk(res) as Promise<never>;

  return res.json();
}

export async function recordLearningVisit(
  json: InferRequestType<typeof learning.history.$post>["json"]
) {
  const res = await learning.history.$post({ json });
  if (!res.ok) return assertOk(res) as Promise<never>;

  return res.json();
}

export async function getLearningHistory(
  { page = 1, limit = 20 }: Page = {},
  { signal }: FetchOptions = {}
) {
  const res = await learning.history.$get(
    { query: { page: String(page), limit: String(limit) } },
    { init: { signal } }
  );
  if (!res.ok) return assertOk(res) as Promise<never>;

  return res.json();
}

export async function removeLearningVisit(guideId: string) {
  const res = await learning.history[":guideId"].$delete({
    param: { guideId },
  });
  await assertOk(res);
}

export async function clearLearningHistory() {
  const res = await learning.history.$delete();
  await assertOk(res);
}

export async function getLearningReads(
  guideIds: Array<string>,
  { signal }: FetchOptions = {}
) {
  const reads: Array<LearningRead> = [];

  for (let offset = 0; offset < guideIds.length; offset += 100) {
    const res = await learning.reads.$get(
      { query: { guide_ids: guideIds.slice(offset, offset + 100).join(",") } },
      { init: { signal } }
    );
    if (!res.ok) return assertOk(res) as Promise<never>;

    const data = await res.json();
    reads.push(...data.reads);
  }

  return { reads };
}

export async function setLearningRead(
  guideId: string,
  json: InferRequestType<(typeof learning.reads)[":guideId"]["$put"]>["json"]
) {
  const res = await learning.reads[":guideId"].$put({
    param: { guideId },
    json,
  });
  if (!res.ok) return assertOk(res) as Promise<never>;

  return res.json();
}

export type LearningRead = NonNullable<
  Awaited<ReturnType<typeof setLearningRead>>["read"]
>;
