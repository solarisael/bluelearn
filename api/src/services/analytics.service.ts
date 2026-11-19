import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import type { Bindings } from "../types";

export function analyticsEnabled(env: Bindings) {
  return env.ANALYTICS_COLLECTION_ENABLED === "true";
}

export async function emitLearningTransition(
  service: SupabaseClient<Database>,
  env: Bindings,
  userId: string,
  result: Json | null
) {
  if (
    !analyticsEnabled(env) ||
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  )
    return;

  const event = result._event;

  if (!event) return;

  try {
    const { error } = await service.rpc("analytics_ingest", {
      p_events: [event],
      p_user_id: userId,
      p_enabled: true,
      p_server: true,
    });

    if (error)
      console.error(
        "Learning analytics transition was not recorded",
        error.code
      );
  } catch (error) {
    console.error(
      "Learning analytics transition delivery failed",
      error instanceof Error ? error.name : "unknown"
    );
  }
}

export async function cleanupLearningAnalytics(
  service: SupabaseClient<Database>,
  env: Bindings
) {
  try {
    const { error: settingsError } = await service.rpc(
      "analytics_set_collection",
      {
        p_enabled: analyticsEnabled(env),
      }
    );

    if (settingsError)
      console.error(
        "Analytics collection settings update failed",
        settingsError.code
      );

    const { error } = await service.rpc("analytics_cleanup", {
      p_batch_size: 5000,
    });

    if (error) throw error;
  } catch (error) {
    console.error("Learning and analytics retention cleanup failed", error);
    throw error;
  }
}
