import { z } from "zod";

export const analyticsSourceSchema = z.enum([
  "search",
  "subject",
  "objective",
  "guide",
  "direct",
  "history",
  "resume",
]);
export const learningPreferencesSchema = z.object({
  history_paused: z.boolean(),
});
export const updateLearningPreferencesSchema = z
  .strictObject({
    history_paused: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const recordLearningHistorySchema = z.strictObject({
  event_id: z.uuid(),
  guide_id: z.uuid(),
  revision_id: z.uuid(),
  source: analyticsSourceSchema,
  objective_id: z.uuid().optional(),
  objective_revision_id: z.uuid().optional(),
  target_guide_base_id: z.uuid().optional(),
});
export const learningHistoryResponseSchema = z.object({
  visits: z.array(
    z.object({
      guide_id: z.uuid(),
      guide_base_id: z.uuid(),
      revision_id: z.uuid(),
      source: analyticsSourceSchema,
      visited_at: z.string(),
      title: z.string().nullable(),
      slug: z.string().nullable(),
      variant_slug: z.string().nullable(),
      available: z.boolean(),
    })
  ),
  total: z.number().int().nonnegative(),
  retention_days: z.literal(90),
  paused: z.boolean(),
});
export type AnalyticsSource = z.infer<typeof analyticsSourceSchema>;
export type LearningPreferences = z.infer<typeof learningPreferencesSchema>;
