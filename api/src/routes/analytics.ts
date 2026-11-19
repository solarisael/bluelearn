import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  analyticsEventsInputSchema,
  analyticsEventsResponseSchema,
  analyticsReportQuerySchema,
  analyticsReportResponseSchema,
} from "@bluelearn/schemas";
import { errorResponses, jsonContent, validate } from "../lib/openapi";
import {
  getAuthenticatedUser,
  getServiceSupabase,
  requireUser,
} from "../middleware/auth.middleware";
import { rateLimitMiddleware } from "../middleware/rate-limit.middleware";
import { DASHBOARD } from "../middleware/rateLimits";
import { analyticsEnabled } from "../services/analytics.service";
import { learningResult } from "../services/learning.service";
import { ServiceError } from "../lib/service-error";
import type { HonoEnv } from "../types";

export const analyticsRouter = new Hono<HonoEnv>()
  .post(
    "/events",
    describeRoute({
      tags: ["Analytics"],
      summary: "Accept bounded untrusted client telemetry",
      responses: {
        200: jsonContent(
          analyticsEventsResponseSchema,
          "Accepted and duplicate event counts"
        ),
        ...errorResponses(400, 409, 500),
      },
    }),
    rateLimitMiddleware({
      windowSeconds: 60,
      max: 60,
      keyBy: "ip",
      bucket: "analytics-events",
    }),
    validate("json", analyticsEventsInputSchema),
    async (c) => {
      const { user } = await getAuthenticatedUser(c);
      const result = await getServiceSupabase(c).rpc("analytics_ingest", {
        p_events: c.req.valid("json").events,
        p_user_id: user?.id,
        p_enabled: analyticsEnabled(c.env),
        p_server: false,
      });
      return c.json(learningResult(result, analyticsEventsResponseSchema));
    }
  )
  .get(
    "/report",
    describeRoute({
      tags: ["Analytics"],
      summary: "Get the admin-only UTC aggregate report",
      responses: {
        200: jsonContent(
          analyticsReportResponseSchema,
          "Aggregate analytics without account identifiers"
        ),
        ...errorResponses(400, 401, 403, 500),
      },
    }),
    requireUser,
    rateLimitMiddleware({ ...DASHBOARD, bucket: "analytics-report" }),
    validate("query", analyticsReportQuerySchema),
    async (c) => {
      const { data: allowed, error } = await c
        .get("supabase")
        .rpc("has_role", { check_role: "admin" });

      if (error) throw new ServiceError("Unable to verify report access", 500);
      if (!allowed) throw new ServiceError("Admin access required", 403);

      const service = getServiceSupabase(c);
      const { error: settingsError } = await service.rpc(
        "analytics_set_collection",
        { p_enabled: analyticsEnabled(c.env) }
      );

      if (settingsError)
        throw new ServiceError("Unable to read collection status", 500);

      const { from, to } = c.req.valid("query");
      return c.json(
        learningResult(
          await c.get("supabase").rpc("analytics_report", {
            p_from: from,
            p_to: to,
          }),
          analyticsReportResponseSchema
        )
      );
    }
  );
