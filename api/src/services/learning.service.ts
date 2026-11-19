import type { PostgrestError } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Json } from "../database.types";
import { ServiceError } from "../lib/service-error";

export function learningResult<T>(
  result: { data: Json | null; error: PostgrestError | null },
  schema: z.ZodType<T>
): T {
  if (result.error) {
    const code = result.error.code;

    if (code === "42501") throw new ServiceError("Access denied", 403);
    if (code === "P0002") throw new ServiceError(result.error.message, 404);
    if (code === "PT409" || code === "23505") {
      throw new ServiceError(result.error.message, 409);
    }
    if (
      code === "22023" ||
      code === "22P02" ||
      code === "23514" ||
      code === "23503"
    ) {
      throw new ServiceError(result.error.message, 400);
    }

    console.error("Learning RPC failed", result.error);
    throw new ServiceError("Unable to load or save learning state", 500);
  }

  return schema.parse(result.data);
}
