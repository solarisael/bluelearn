import { useEffect, useRef } from "react";
import { useLocation, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/authContext";
import { analyticsSource, trackEvent } from "@/lib/telemetry";
import { learningErrorCategory } from "@/lib/useLearning";
import { Button } from "@/components/ui/button";

export function ReaderLoadFailure({
  error,
  unavailable = false,
}: {
  error?: Error;
  unavailable?: boolean;
}) {
  const { loading } = useAuth();
  const location = useLocation();
  const navigating = useRouterState({
    select: (state) => state.status === "pending",
  });
  const navigation = `${location.state.__TSR_key}:${location.href}`;
  const sent = useRef<string | null>(null);
  const isUnavailable =
    unavailable || learningErrorCategory(error) === "unavailable";

  useEffect(() => {
    if (loading || navigating) return;

    const record = () => {
      if (document.visibilityState !== "visible" || sent.current === navigation)
        return;

      sent.current = navigation;
      trackEvent({
        name: isUnavailable ? "content_unavailable" : "reader_load_failed",
        source: analyticsSource(location.state.analyticsSource),
        error_category: isUnavailable
          ? "unavailable"
          : learningErrorCategory(error),
      });
    };
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [
    loading,
    navigating,
    isUnavailable,
    error,
    navigation,
    location.state.analyticsSource,
  ]);

  return (
    <div role="alert" className="mx-auto max-w-7xl space-y-3 px-8 py-10">
      <h1 className="text-xl font-semibold">
        {isUnavailable ? "Guide unavailable" : "Could not load this guide"}
      </h1>
      <p>
        {isUnavailable
          ? "This guide is not available for reading."
          : error?.message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="btn-sec"
        onClick={() => window.location.reload()}
      >
        Try again
      </Button>
    </div>
  );
}
