import {
  analyticsEventSchema,
  analyticsSourceSchema,
} from "@bluelearn/schemas";
import type { AnalyticsClientEvent } from "@bluelearn/schemas";
import type { AnalyticsSource } from "@/lib/breadcrumbs";
import { postAnalyticsEvents } from "@/lib/api/analytics";

export type ClientAnalyticsEvent = Omit<AnalyticsClientEvent, "event_id"> & {
  event_id?: string;
};

const MAX_IN_FLIGHT = 20;
const MAX_DIAGNOSTICS = 3;
let inFlight = 0;
let diagnostics = 0;

export function newAnalyticsEventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function eventForDelivery(event: ClientAnalyticsEvent) {
  if (event.name === "progress_save_failed") {
    return {
      name: event.name,
      source: event.source,
      error_category: event.error_category,
    };
  }

  return event;
}


export function analyticsSource(origin?: AnalyticsSource): AnalyticsSource {
  const result = analyticsSourceSchema.safeParse(origin);

  return result.success ? result.data : "direct";
}

export function trackEvent(event: ClientAnalyticsEvent): void {
  if (typeof window === "undefined") return;

  try {
    const deliveryEvent = eventForDelivery(event);
    const result = analyticsEventSchema.safeParse({
      ...deliveryEvent,
      event_id: event.event_id ?? newAnalyticsEventId(),
    });

    if (!result.success) {
      diagnostic("invalid_event");
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      diagnostic("delivery_busy");
      return;
    }

    inFlight += 1;

    void postAnalyticsEvents([result.data], {
      omitAuth: event.name === "progress_save_failed",
    })
      .catch(() => diagnostic("delivery_failed"))
      .finally(() => {
        inFlight -= 1;
      });
  } catch {
    diagnostic("invalid_event");
  }
}

function diagnostic(
  reason: "invalid_event" | "delivery_busy" | "delivery_failed"
) {
  if (diagnostics >= MAX_DIAGNOSTICS) return;

  diagnostics += 1;
  console.warn("Analytics delivery diagnostic:", reason);
}
