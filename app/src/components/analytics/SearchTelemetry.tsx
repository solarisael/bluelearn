import { useEffect } from "react";
import { useAuth } from "@/lib/authContext";
import { newAnalyticsEventId, trackEvent } from "@/lib/telemetry";

const pendingSubmissions = new Set<string>();
const MAX_PENDING_SUBMISSIONS = 20;
let identifierDiagnosticLogged = false;

export function beginSearchSubmission(): string | undefined {
  try {
    const eventId = newAnalyticsEventId();
    pendingSubmissions.add(eventId);

    if (pendingSubmissions.size > MAX_PENDING_SUBMISSIONS) {
      const oldest = pendingSubmissions.values().next().value;

      if (oldest) pendingSubmissions.delete(oldest);
    }

    trackEvent({
      event_id: eventId,
      name: "search_submitted",
      source: "search",
    });

    return eventId;
  } catch {
    if (!identifierDiagnosticLogged) {
      identifierDiagnosticLogged = true;
      console.warn("Analytics search identifier is unavailable.");
    }

    return undefined;
  }
}

export function SearchTelemetry({
  submissionId,
  resultCount,
  failed,
  pending,
}: {
  submissionId?: string;
  resultCount: number;
  failed: boolean;
  pending: boolean;
}) {
  const { loading } = useAuth();

  useEffect(() => {
    if (
      loading ||
      pending ||
      !submissionId ||
      !pendingSubmissions.has(submissionId)
    )
      return;

    const recordResults = () => {
      if (
        document.visibilityState !== "visible" ||
        !pendingSubmissions.has(submissionId)
      )
        return;

      pendingSubmissions.delete(submissionId);

      if (!failed && resultCount === 0) {
        trackEvent({
          name: "search_zero_results",
          source: "search",
          result_count: 0,
        });
      }
    };
    recordResults();
    document.addEventListener("visibilitychange", recordResults);

    return () =>
      document.removeEventListener("visibilitychange", recordResults);
  }, [loading, pending, submissionId, resultCount, failed]);

  return null;
}
