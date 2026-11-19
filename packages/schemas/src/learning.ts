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
  show_completed_objectives: z.boolean(),
});
export const updateLearningPreferencesSchema = z
  .strictObject({
    history_paused: z.boolean().optional(),
    show_completed_objectives: z.boolean().optional(),
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
export const learningReadSchema = z.object({
  guide_id: z.uuid(),
  revision_id: z.uuid(),
  marked_at: z.string(),
  has_newer_revision: z.boolean(),
});
export const learningReadsQuerySchema = z.strictObject({
  guide_ids: z
    .string()
    .transform((value) => (value === "" ? [] : value.split(",")))
    .pipe(z.array(z.uuid()).max(100)),
});
export const updateLearningReadSchema = z.strictObject({
  revision_id: z.uuid(),
  read: z.boolean(),
});
export const learningReadsResponseSchema = z.object({
  reads: z.array(learningReadSchema),
});
export const learningReadResponseSchema = z.object({
  read: learningReadSchema.nullable(),
  changed: z.boolean(),
});
export const learningEnrollmentSchema = z.object({
  objective_revision_id: z.uuid(),
  target_guide_base_id: z.uuid().nullable(),
  position_guide_base_id: z.uuid().nullable(),
  started_at: z.string(),
  last_resumed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  completed_revision_id: z.uuid().nullable(),
  last_completed_at: z.string().nullable(),
});
export const learningCountsSchema = z.object({
  included: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  requested: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
});
export const learningStepSchema = z.object({
  guide_base_id: z.uuid().nullable(),
  guide_id: z.uuid().nullable(),
  variant_slug: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
  revision_id: z.uuid().nullable(),
  state: z.enum(["read", "unread", "requested", "unavailable"]),
  has_newer_revision: z.boolean(),
  is_target: z.boolean(),
});
export const learningObjectiveStateSchema = z.object({
  objective_id: z.uuid(),
  slug: z.string(),
  title: z.string().nullable(),
  enrollment: learningEnrollmentSchema.nullable(),
  current_revision_id: z.uuid(),
  steps: z.array(learningStepSchema),
  counts: learningCountsSchema,
});
export const learningObjectivesResponseSchema = z.object({
  objectives: z.array(learningObjectiveStateSchema.omit({ steps: true })),
  total: z.number().int().nonnegative(),
});
export const learningObjectiveActionSchema = z.enum([
  "start",
  "resume",
  "complete",
  "reopen",
]);
export const learningObjectiveActionInputSchema = z.strictObject({
  event_id: z.uuid(),
  expected_revision_id: z.uuid(),
  target_guide_base_id: z.uuid().optional(),
});
export const learningObjectivePositionSchema =
  learningObjectiveActionInputSchema.omit({ event_id: true }).extend({
    guide_base_id: z.uuid(),
  });
export const publicLearningResponseSchema = z.object({
  objectives: z.array(
    z.object({
      slug: z.string(),
      title: z.string().nullable(),
      completed_revision_id: z.uuid(),
      completed_at: z.string(),
    })
  ),
});
export type AnalyticsSource = z.infer<typeof analyticsSourceSchema>;
export type LearningPreferences = z.infer<typeof learningPreferencesSchema>;
export type LearningRead = z.infer<typeof learningReadSchema>;
export type LearningObjectiveState = z.infer<
  typeof learningObjectiveStateSchema
>;
