import { useEffect, useState } from "react";
import type { AnalyticsRange, AnalyticsReport } from "@/lib/api/analytics";
import { AnalyticsReportView } from "@/components/analytics/AnalyticsReportView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchAnalyticsReport } from "@/lib/api/analytics";
import { ApiError } from "@/lib/api/apiHelpers";
import { useAuth, useRequireRole } from "@/lib/authContext";

export function defaultAnalyticsRange(): AnalyticsRange {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function analyticsRangeError({
  from,
  to,
}: AnalyticsRange): string | null {
  const dates = [from, to].map((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;

    const time = Date.parse(`${date}T00:00:00Z`);

    return Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === date
      ? time
      : NaN;
  });

  if (dates.some((date) => !Number.isFinite(date)))
    return "Select two valid UTC dates.";
  if (from > to) return "The start date must not follow the end date.";
  if ((dates[1] - dates[0]) / 86_400_000 + 1 > 365)
    return "Select no more than 365 inclusive UTC days.";

  return null;
}

export function AnalyticsDashboard() {
  const access = useRequireRole("admin");
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const [range, setRange] = useState(defaultAnalyticsRange);
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [ownedReport, setOwnedReport] = useState<{
    ownerId: string;
    data: AnalyticsReport;
  } | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (access !== "allowed" || !accountId) return;

    const controller = new AbortController();
    setLoading(true);
    setRequestError(null);

    void fetchAnalyticsReport(range, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setOwnedReport({ ownerId: accountId, data });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 403) {
          setOwnedReport(null);
        }

        setRequestError(
          error instanceof ApiError && error.status === 403
            ? "Administrator access is required to view analytics."
            : "Analytics could not be loaded. Try again."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [access, accountId, range, refresh]);

  const report = ownedReport?.ownerId === accountId ? ownedReport.data : null;

  if (access === "pending" || !accountId) {
    return <p role="status">Checking administrator access...</p>;
  }
  if (access !== "allowed") {
    return (
      <p role="alert">Administrator access is required to view analytics.</p>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
      </header>

      <form
        className="flex flex-wrap items-end gap-4 rounded-md border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const error = analyticsRangeError(draft);
          setRangeError(error);

          if (error) return;

          setRange({ ...draft });
        }}
        aria-label="Report dates in UTC"
      >
        <div className="space-y-2">
          <label htmlFor="analytics-from" className="text-sm font-medium">
            From (UTC)
          </label>
          <Input
            id="analytics-from"
            type="date"
            required
            value={draft.from}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                from: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="analytics-to" className="text-sm font-medium">
            To (UTC)
          </label>
          <Input
            id="analytics-to"
            type="date"
            required
            value={draft.to}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, to: event.target.value }))
            }
          />
        </div>
        <Button type="submit" size="lg" className="btn-pri">
          Show report
        </Button>
        {rangeError && (
          <p role="alert" className="w-full text-sm text-destructive">
            {rangeError}
          </p>
        )}
      </form>
      {report && (
        <p className="text-sm text-muted-foreground">
          Showing {report.range.from} to {report.range.to} (UTC)
          {loading ? " · Updating" : ""}
        </p>
      )}

      {loading && <p role="status">Loading analytics...</p>}
      {requestError && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {requestError}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="btn-sec"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      )}
      {report && <AnalyticsReportView report={report} />}
    </div>
  );
}
