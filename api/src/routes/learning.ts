import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  learningPreferencesSchema,
  updateLearningPreferencesSchema,
  recordLearningHistorySchema,
  learningHistoryResponseSchema,
  paginationSchema,
} from "@bluelearn/schemas";
import { errorResponses, jsonContent, validate } from "../lib/openapi";
import { requireUser } from "../middleware/auth.middleware";
import { rateLimitMiddleware } from "../middleware/rate-limit.middleware";
import { learningResult } from "../services/learning.service";
import type { HonoEnv } from "../types";

const guideParam = z.object({ guideId: z.uuid() });
const okSchema = z.object({ ok: z.literal(true) });
const recordedSchema = z.object({ recorded: z.boolean() });
const writeLimit = rateLimitMiddleware({
  windowSeconds: 60,
  max: 120,
  bucket: "learning-write",
});
const description = (summary: string, schema: z.ZodType) =>
  describeRoute({
    tags: ["Learning"],
    summary,
    responses: {
      200: jsonContent(schema, summary),
      ...errorResponses(400, 401, 403, 404, 409, 500),
    },
  });

export const learningRouter = new Hono<HonoEnv>()
  .use(requireUser)
  .get(
    "/preferences",
    description("Get private learning preferences", learningPreferencesSchema),
    async (c) => {
      return c.json(
        learningResult(
          await c.get("supabase").rpc("learning_preferences_state"),
          learningPreferencesSchema
        )
      );
    }
  )
  .patch(
    "/preferences",
    description("Save private learning preferences", learningPreferencesSchema),
    writeLimit,
    validate("json", updateLearningPreferencesSchema),
    async (c) => {
      return c.json(
        learningResult(
          await c.get("supabase").rpc("learning_preferences_state", {
            p_patch: c.req.valid("json"),
          }),
          learningPreferencesSchema
        )
      );
    }
  )
  .post(
    "/history",
    description("Record a visible published reader visit", recordedSchema),
    writeLimit,
    validate("json", recordLearningHistorySchema),
    async (c) => {
      return c.json(
        learningResult(
          await c.get("supabase").rpc("learning_history_state", {
            p_action: "record",
            p_input: c.req.valid("json"),
          }),
          recordedSchema
        )
      );
    }
  )
  .get(
    "/history",
    description(
      "List private visits retained for ninety days",
      learningHistoryResponseSchema
    ),
    validate("query", paginationSchema),
    async (c) => {
      const { page, limit } = c.req.valid("query");
      return c.json(
        learningResult(
          await c.get("supabase").rpc("learning_history_state", {
            p_action: "list",
            p_page: page,
            p_limit: limit,
          }),
          learningHistoryResponseSchema
        )
      );
    }
  )
  .delete(
    "/history/:guideId",
    description("Remove one private visit", okSchema),
    writeLimit,
    validate("param", guideParam),
    async (c) => {
      return c.json(
        learningResult(
          await c.get("supabase").rpc("learning_history_state", {
            p_action: "remove",
            p_input: { guide_id: c.req.valid("param").guideId },
          }),
          okSchema
        )
      );
    }
  )
  .delete(
    "/history",
    description("Clear private visits", okSchema),
    writeLimit,
    async (c) => {
      return c.json(
        learningResult(
          await c
            .get("supabase")
            .rpc("learning_history_state", { p_action: "clear" }),
          okSchema
        )
      );
    }
  );
