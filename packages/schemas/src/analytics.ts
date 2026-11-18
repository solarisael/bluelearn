import { z } from "zod";
import { analyticsSourceSchema } from "./learning";

export const analyticsClientEventNameSchema = z.enum([
  "search_submitted",
  "search_zero_results",
  "search_result_selected",
  "reader_opened",
  "variant_selected",
  "reader_load_failed",
  "progress_save_failed",
  "content_unavailable",
]);
export const analyticsEventSchema = z
  .strictObject({
    event_id: z.uuid(),
    name: analyticsClientEventNameSchema,
    source: analyticsSourceSchema.optional(),
    guide_id: z.uuid().optional(),
    revision_id: z.uuid().optional(),
    guide_base_id: z.uuid().optional(),
    objective_id: z.uuid().optional(),
    objective_revision_id: z.uuid().optional(),
    entity_type: z.enum(["guide", "objective"]).optional(),
    result_count: z.number().int().min(0).max(1_000_000).optional(),
    error_category: z
      .enum(["network", "server", "unavailable", "conflict", "forbidden"])
      .optional(),
  })
  .superRefine((event, context) => {
    if (
      event.name === "variant_selected" &&
      (!event.guide_id || event.revision_id !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Variant selection requires a guide without a revision",
      });
    }
    if (
      event.name === "progress_save_failed" &&
      (event.guide_id !== undefined ||
        event.revision_id !== undefined ||
        event.guide_base_id !== undefined ||
        event.objective_id !== undefined ||
        event.objective_revision_id !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Progress-save diagnostics cannot include content identifiers",
      });
    }
  });
export const analyticsEventsInputSchema = z.strictObject({
  events: z.array(analyticsEventSchema).min(1).max(20),
});
export const analyticsEventsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  enabled: z.boolean(),
});
export const analyticsReportQuerySchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return days >= 0 && days < 365;
  });
export const analyticsMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: z.enum([
    "events",
    "accounts",
    "guides",
    "objectives",
    "requests",
    "assignments",
    "days",
    "percent",
    "panels",
  ]),
  definition: z.string(),
  reason: z.string().nullable(),
});
export const analyticsReportResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    timezone: z.literal("UTC"),
    raw_retention_days: z.literal(90),
    aggregate_retention_days: z.literal(365),
  }),
  enabled: z.boolean(),
  collection_started_at: z.string().nullable(),
  observation: z.object({
    status: z.enum(["complete", "partial", "unavailable"]),
    reason: z.string().nullable(),
  }),
  sections: z.array(
    z.object({
      key: z.enum([
        "discovery",
        "reading",
        "learning",
        "editorial",
        "reliability",
      ]),
      title: z.string(),
      metrics: z.array(analyticsMetricSchema),
    })
  ),
  daily: z.array(
    z.object({
      day: z.string(),
      observation: z.enum(["complete", "partial", "unavailable"]),
      reader_opens: z.number().nullable(),
      read_marks: z.number().nullable(),
      objective_starts: z.number().nullable(),
      objective_completions: z.number().nullable(),
      reader_failures: z.number().nullable(),
    })
  ),
  guides: z.array(
    z.object({
      guide_base_id: z.uuid(),
      title: z.string().nullable(),
      opens: z.number(),
      read_marks: z.number(),
      signed_in_readers: z.number().nullable(),
    })
  ),
  objectives: z.array(
    z.object({
      objective_id: z.uuid(),
      title: z.string().nullable(),
      starts: z.number(),
      completions: z.number(),
      signed_in_learners: z.number().nullable(),
    })
  ),
});
export type AnalyticsClientEvent = z.infer<typeof analyticsEventSchema>;
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportResponseSchema>;
