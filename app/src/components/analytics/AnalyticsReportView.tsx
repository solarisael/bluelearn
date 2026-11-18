import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { AnalyticsReport } from "@/lib/api/analytics";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const sections = [
  { key: "discovery", title: "Discovery" },
  { key: "reading", title: "Reading" },
  { key: "learning", title: "Learning" },
  { key: "editorial", title: "Editorial health" },
  { key: "reliability", title: "Reliability" },
] as const;
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function measurement(value: number | null) {
  return value === null ? (
    <span><span aria-hidden="true">—</span><span className="sr-only">Unavailable</span></span>
  ) : (
    numberFormat.format(value)
  );
}

function ReportDetails({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Collapsible className="group">
      <h2>
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="lg"
            className="btn-sec w-full justify-between"
          >
            {title}
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function AnalyticsReportView({ report }: { report: AnalyticsReport }) {
  const metrics = report.sections.flatMap((section) => section.metrics);
  const reasons = [
    ...new Set(
      metrics.flatMap((metric) => (metric.reason ? [metric.reason] : []))
    ),
  ];
  const sources = metrics.filter((metric) =>
    metric.key.startsWith("reader_source_")
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 [&_th:not(:first-child)]:text-right [&_td:not(:first-child)]:text-right [&_td]:tabular-nums">
      <p className="text-sm text-muted-foreground">
        {report.enabled ? "Collection on" : "Collection off"}
        {report.collection_started_at &&
          ` · First collected ${new Date(report.collection_started_at).toLocaleDateString(undefined, { timeZone: "UTC" })}`}
        {" · — Unavailable"}
      </p>
      {report.observation.status !== "complete" && (
        <p role="status" className="text-sm text-muted-foreground">
          <strong>{report.observation.status === "partial" ? "Partial activity totals. " : "Activity totals unavailable. "}</strong>
          {report.observation.reason}
        </p>
      )}

      {sections.map(({ key, title }) => {
        const section = report.sections.find((item) => item.key === key);
        const visibleMetrics =
          section?.metrics.filter(
            (metric) => !metric.key.startsWith("reader_source_")
          ) ?? [];

        return (
          <section
            key={key}
            aria-labelledby={`analytics-${key}`}
            className="space-y-3"
          >
            <h2
              id={`analytics-${key}`}
              className="font-mono text-sm font-semibold tracking-wide uppercase"
            >
              {section?.title ?? title}
            </h2>
            {visibleMetrics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {visibleMetrics.map((metric) => (
                  <div
                    key={metric.key}
                    className="space-y-1 rounded-md border p-3"
                  >
                    <dt className="text-sm text-muted-foreground">
                      {metric.label.replace(": current snapshot", "")}
                    </dt>
                    <dd>
                      <p className="font-mono text-2xl font-semibold">
                        {measurement(metric.value)}
                        {metric.value !== null && metric.unit === "percent"
                          ? "%"
                          : ""}
                        {metric.value !== null && metric.unit === "days"
                          ? " days"
                          : ""}
                      </p>
                      {metric.label.includes(": current snapshot") && (
                        <span className="text-xs text-muted-foreground">
                          Current
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        );
      })}

      {sources.length > 0 && (
        <ReportDetails title="Reading sources">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {sources.map((metric) => (
              <div key={metric.key} className="flex justify-between gap-3">
                <dt className="capitalize">
                  {metric.label.replace("Reader opens: ", "")}
                </dt>
                <dd className="font-mono">{measurement(metric.value)}</dd>
              </div>
            ))}
          </dl>
        </ReportDetails>
      )}

      <ReportDetails title="Daily trends">
        {report.daily.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No daily data for this range.
          </p>
        ) : (
          <Table>
            <TableCaption className="sr-only">
              Daily trends by UTC date
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">UTC day</TableHead>
                <TableHead scope="col">Reader opens</TableHead>
                <TableHead scope="col">Read marks</TableHead>
                <TableHead scope="col">Objective starts</TableHead>
                <TableHead scope="col">Objective completions</TableHead>
                <TableHead scope="col">Reader failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.daily.map((row) => (
                <TableRow key={row.day}>
                  <TableCell>
                    {row.day}
                    {row.observation === "partial" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.day === today ? "In progress · Partial" : "Partial"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{measurement(row.reader_opens)}</TableCell>
                  <TableCell>{measurement(row.read_marks)}</TableCell>
                  <TableCell>{measurement(row.objective_starts)}</TableCell>
                  <TableCell>
                    {measurement(row.objective_completions)}
                  </TableCell>
                  <TableCell>{measurement(row.reader_failures)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportDetails>

      <ReportDetails title="Guides">
        {report.guides.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {report.observation.status !== "unavailable"
              ? "No guide activity was recorded in this range."
              : "Guide activity is unavailable for this range."}
          </p>
        ) : (
          <Table>
            <TableCaption className="sr-only">Guide breakdown</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Guide</TableHead>
                <TableHead scope="col">Opens</TableHead>
                <TableHead scope="col">Read marks</TableHead>
                <TableHead scope="col">Signed-in readers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.guides.map((row) => (
                <TableRow key={row.guide_base_id}>
                  <TableCell className="whitespace-normal">
                    {row.title ?? "Unavailable guide"}
                  </TableCell>
                  <TableCell>{measurement(row.opens)}</TableCell>
                  <TableCell>{measurement(row.read_marks)}</TableCell>
                  <TableCell>{measurement(row.signed_in_readers)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportDetails>

      <ReportDetails title="Objectives">
        {report.objectives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {report.observation.status !== "unavailable"
              ? "No objective activity was recorded in this range."
              : "Objective activity is unavailable for this range."}
          </p>
        ) : (
          <Table>
            <TableCaption className="sr-only">Objective breakdown</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Objective</TableHead>
                <TableHead scope="col">Starts</TableHead>
                <TableHead scope="col">Completions</TableHead>
                <TableHead scope="col">Signed-in learners</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.objectives.map((row) => (
                <TableRow key={row.objective_id}>
                  <TableCell className="whitespace-normal">
                    {row.title ?? "Unavailable objective"}
                  </TableCell>
                  <TableCell>{measurement(row.starts)}</TableCell>
                  <TableCell>{measurement(row.completions)}</TableCell>
                  <TableCell>{measurement(row.signed_in_learners)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ReportDetails>

      <ReportDetails title="Data notes and definitions">
        <div className="space-y-4 text-sm">
          <p>
            Dates use UTC and include both selected days. — means unavailable or
            withheld, never zero.
          </p>
          <p>
            Partial activity totals include only recorded events in retained
            collection periods. They do not estimate activity during gaps.
            Account counts and return cohorts still require complete observation.
          </p>
          <p>
            Raw events: {report.range.raw_retention_days} days. Daily totals:{" "}
            {report.range.aggregate_retention_days} days.
          </p>
          <p>
            Account counts require at least five accounts. Anonymous opens count
            events, not people. Personal histories stay private.
          </p>
          <p>
            Guide and objective tables show up to 50 entries. Account counts
            cover the selected range; daily counts are not added together.
          </p>
          <p>
            Sources describe the navigation context carried into the reader,
            including reloads and variant changes. They are not direct-conversion rates.
          </p>
          <p>
            Collection gaps, blocked requests, failed delivery, and automated
            traffic can affect measurements.
          </p>
          {!report.enabled && (
            <p>
              Collection is off. Existing editorial records can still provide
              measurements.
            </p>
          )}
          {reasons.length > 0 && (
            <ul className="list-disc space-y-2 pl-5">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <dl className="space-y-3">
            {metrics.map((metric) => (
              <div key={metric.key}>
                <dt className="font-semibold">
                  {metric.label} ({metric.unit})
                </dt>
                <dd className="text-muted-foreground">{metric.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      </ReportDetails>
    </div>
  );
}
