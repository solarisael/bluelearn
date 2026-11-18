// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  isInaccessible,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect } from "react";
import type { AnalyticsReport } from "@/lib/api/analytics";
import { AnalyticsReportView } from "@/components/analytics/AnalyticsReportView";
import {
  AnalyticsDashboard,
  analyticsRangeError,
  defaultAnalyticsRange,
} from "@/components/analytics/AnalyticsDashboard";

const { fetchAnalyticsReport, access, auth } = vi.hoisted(() => ({
  fetchAnalyticsReport: vi.fn(),
  access: { value: "allowed" },
  auth: { user: { id: "account-a" } },
}));
vi.mock("@/lib/api/analytics", () => ({ fetchAnalyticsReport }));
vi.mock("@/lib/authContext", () => ({
  useRequireRole: () => access.value,
  useAuth: () => auth,
}));

const report: AnalyticsReport = {
  range: {
    from: "2026-11-01",
    to: "2026-11-16",
    timezone: "UTC",
    raw_retention_days: 90,
    aggregate_retention_days: 365,
  },
  enabled: false,
  collection_started_at: null,
  observation: { status: "complete", reason: null },
  sections: [
    {
      key: "discovery",
      title: "Discovery",
      metrics: [
        {
          key: "searches",
          label: "Submitted searches",
          value: 0,
          unit: "events",
          definition: "Explicit nonempty searches only.",
          reason: null,
        },
      ],
    },
    {
      key: "reading",
      title: "Reading",
      metrics: [
        {
          key: "readers",
          label: "Signed-in accounts",
          value: null,
          unit: "accounts",
          definition: "Distinct accounts across the full date range.",
          reason: "Suppressed: fewer than five accounts.",
        },
      ],
    },
    {
      key: "learning",
      title: "Learning",
      metrics: [
        {
          key: "return_30",
          label: "Thirty-day return",
          value: null,
          unit: "percent",
          definition:
            "Matured daily cohorts can include the same account on multiple cohort days.",
          reason: "Unavailable: complete observation windows have not matured.",
        },
      ],
    },
    {
      key: "editorial",
      title: "Editorial health",
      metrics: [
        {
          key: "overdue",
          label: "Overdue assignments",
          value: 3,
          unit: "assignments",
          definition: "Current snapshot, not a date-range event total.",
          reason: null,
        },
      ],
    },
    {
      key: "reliability",
      title: "Reliability",
      metrics: [
        {
          key: "failures",
          label: "Progress-save failures",
          value: 0,
          unit: "events",
          definition:
            "Failed progress writes, separate from successful actions.",
          reason: null,
        },
      ],
    },
  ],
  daily: [
    {
      day: "2026-11-16",
      observation: "complete",
      reader_opens: 0,
      read_marks: 1,
      objective_starts: 0,
      objective_completions: 0,
      reader_failures: null,
    },
  ],
  guides: [
    {
      guide_base_id: "00000000-0000-4000-8000-000000000001",
      title: "Guide topic",
      opens: 2,
      read_marks: 1,
      signed_in_readers: null,
    },
  ],
  objectives: [
    {
      objective_id: "00000000-0000-4000-8000-000000000002",
      title: "Objective topic",
      starts: 2,
      completions: 0,
      signed_in_learners: null,
    },
  ],
};

beforeEach(() => {
  access.value = "allowed";
  auth.user = { id: "account-a" };
  fetchAnalyticsReport.mockReset();
  fetchAnalyticsReport.mockResolvedValue(report);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("analytics report", () => {
  it("labels partial event totals while leaving withheld accounts unavailable", () => {
    render(<AnalyticsReportView report={{
      ...report,
      observation: { status: "partial", reason: "Collection has gaps." },
    }} />);
    expect(screen.getByRole("status").textContent).toContain("Partial activity totals.");
    expect(screen.getByRole("status").textContent).toContain("Collection has gaps.");
    const accounts = screen.getByText("Signed-in accounts").parentElement!;
    expect(within(accounts).getByText("Unavailable")).toBeDefined();
    expect(within(accounts).queryByText("0")).toBeNull();
  });

  it("keeps explanations on demand while distinguishing unavailable values from measured zeros", () => {
    render(<AnalyticsReportView report={report} />);

    for (const name of [
      "Discovery",
      "Reading",
      "Learning",
      "Editorial health",
      "Reliability",
    ]) {
      expect(isInaccessible(screen.getByRole("heading", { name }))).toBe(false);
    }

    const searches = screen.getByText("Submitted searches").parentElement!;
    const readers = screen.getByText("Signed-in accounts").parentElement!;
    expect(
      isInaccessible(within(searches).getByText("0", { exact: true }))
    ).toBe(false);
    expect(isInaccessible(within(readers).getByText("Unavailable"))).toBe(
      false
    );
    expect(within(readers).queryByText("0", { exact: true })).toBeNull();
    expect(
      screen.queryByText(report.sections[0].metrics[0].definition)
    ).toBeNull();
    expect(
      screen.queryByText(report.sections[1].metrics[0].reason!)
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Data notes and definitions" })
    );

    expect(
      isInaccessible(screen.getByText(report.sections[0].metrics[0].definition))
    ).toBe(false);
    expect(
      isInaccessible(screen.getByText(report.sections[1].metrics[0].reason!))
    ).toBe(false);
    expect(
      isInaccessible(screen.getByText(report.sections[2].metrics[0].reason!))
    ).toBe(false);
    expect(
      isInaccessible(screen.getByText(report.sections[3].metrics[0].definition))
    ).toBe(false);
  });

  it("opens trend and breakdown tables on demand without replacing missing values with zeros", () => {
    render(<AnalyticsReportView report={report} />);

    expect(screen.queryByRole("table")).toBeNull();
    for (const name of ["Daily trends", "Guides", "Objectives"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    const daily = screen.getByRole("table", {
      name: "Daily trends by UTC date",
    });
    const guides = screen.getByRole("table", { name: "Guide breakdown" });
    const objectives = screen.getByRole("table", {
      name: "Objective breakdown",
    });
    expect(
      isInaccessible(within(daily).getByRole("cell", { name: "2026-11-16" }))
    ).toBe(false);
    expect(isInaccessible(within(daily).getByText("Unavailable"))).toBe(
      false
    );
    expect(
      isInaccessible(within(guides).getByRole("cell", { name: "Guide topic" }))
    ).toBe(false);
    expect(isInaccessible(within(guides).getByText("Unavailable"))).toBe(
      false
    );
    expect(
      isInaccessible(
        within(objectives).getByRole("cell", { name: "Objective topic" })
      )
    ).toBe(false);
    expect(
      isInaccessible(within(objectives).getByText("Unavailable"))
    ).toBe(false);
  });

  it("explains absent observations rather than drawing zero-valued tables", () => {
    render(
      <AnalyticsReportView
        report={{
          ...report,
          sections: [],
          observation: { status: "unavailable", reason: "No retained collection covers this range." },
          daily: [],
          guides: [],
          objectives: [],
        }}
      />
    );

    for (const name of ["Daily trends", "Guides", "Objectives"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("0", { exact: true })).toBeNull();
    expect(screen.getByText("Guide activity is unavailable for this range.")).toBeDefined();
    expect(screen.getByText("Objective activity is unavailable for this range.")).toBeDefined();
  });
  it("describes empty observed breakdowns as no recorded activity", () => {
    render(<AnalyticsReportView report={{
      ...report,
      guides: [],
      objectives: [],
      sections: [{
        key: "reading",
        title: "Reading",
        metrics: [
          { ...report.sections[0].metrics[0], key: "reader_opened" },
          { ...report.sections[0].metrics[0], key: "objective_started" },
        ],
      }],
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Guides" }));
    fireEvent.click(screen.getByRole("button", { name: "Objectives" }));
    expect(screen.getByText("No guide activity was recorded in this range.")).toBeDefined();
    expect(screen.getByText("No objective activity was recorded in this range.")).toBeDefined();
  });
});

describe("analytics dashboard access and loading", () => {
  it("waits for role resolution and does not request reports for nonadmins", () => {
    access.value = "pending";
    const view = render(<AnalyticsDashboard />);
    expect(screen.getByRole("status").textContent).toContain(
      "Checking administrator access"
    );
    expect(fetchAnalyticsReport).not.toHaveBeenCalled();

    access.value = "not-found";
    view.rerender(<AnalyticsDashboard />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Administrator access is required"
    );
    expect(fetchAnalyticsReport).not.toHaveBeenCalled();
    expect(screen.queryByText("Signed-in accounts")).toBeNull();
  });

  it("hides the previous account report before passive effects run, even with stale allowed roles", async () => {
    const accountAReport = {
      ...report,
      guides: [{ ...report.guides[0], title: "Account A report" }],
    };
    const accountBReport = {
      ...report,
      guides: [{ ...report.guides[0], title: "Account B report" }],
    };
    let resolveAccountB!: (value: AnalyticsReport) => void;
    fetchAnalyticsReport
      .mockResolvedValueOnce(accountAReport)
      .mockReturnValueOnce(
        new Promise<AnalyticsReport>((resolve) => {
          resolveAccountB = resolve;
        })
      );
    const accountBFrames: Array<string> = [];

    function ObserveAccountSwitch() {
      useLayoutEffect(() => {
        if (auth.user.id === "account-b") {
          accountBFrames.push(document.body.textContent);
        }
      });

      return <AnalyticsDashboard />;
    }

    const view = render(<ObserveAccountSwitch />);
    fireEvent.click(await screen.findByRole("button", { name: "Guides" }));
    await screen.findByRole("cell", { name: "Account A report" });
    auth.user = { id: "account-b" };
    view.rerender(<ObserveAccountSwitch />);

    expect(accountBFrames).toHaveLength(1);
    expect(accountBFrames[0]).not.toContain("Account A report");
    expect(screen.queryByRole("cell", { name: "Account A report" })).toBeNull();
    expect(fetchAnalyticsReport).toHaveBeenCalledTimes(2);

    await act(() => {
      resolveAccountB(accountBReport);
      return Promise.resolve();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Guides" }));

    expect(
      isInaccessible(
        await screen.findByRole("cell", { name: "Account B report" })
      )
    ).toBe(false);
    expect(screen.queryByRole("cell", { name: "Account A report" })).toBeNull();
  });

  it("rejects a late previous-account result after the new account report loads", async () => {
    const accountAReport = {
      ...report,
      guides: [{ ...report.guides[0], title: "Late account A report" }],
    };
    const accountBReport = {
      ...report,
      guides: [{ ...report.guides[0], title: "Current account B report" }],
    };
    let resolveAccountA!: (value: AnalyticsReport) => void;
    fetchAnalyticsReport
      .mockReturnValueOnce(
        new Promise<AnalyticsReport>((resolve) => {
          resolveAccountA = resolve;
        })
      )
      .mockResolvedValueOnce(accountBReport);
    const view = render(<AnalyticsDashboard />);

    auth.user = { id: "account-b" };
    view.rerender(<AnalyticsDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Guides" }));
    await screen.findByRole("cell", { name: "Current account B report" });
    await act(() => {
      resolveAccountA(accountAReport);
      return Promise.resolve();
    });

    expect(
      screen.queryByRole("cell", { name: "Late account A report" })
    ).toBeNull();
    expect(
      isInaccessible(
        screen.getByRole("cell", { name: "Current account B report" })
      )
    ).toBe(false);
  });

  it("shows request failure without a zero report and supports an explicit retry", async () => {
    fetchAnalyticsReport.mockRejectedValueOnce(new Error("unavailable"));
    render(<AnalyticsDashboard />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Analytics could not be loaded"
    );
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      isInaccessible(await screen.findByRole("heading", { name: "Discovery" }))
    ).toBe(false);
    expect(fetchAnalyticsReport).toHaveBeenCalledTimes(2);
  });

  it("keeps an open breakdown and its applied dates while a new range loads", async () => {
    let resolveNext!: (value: AnalyticsReport) => void;
    fetchAnalyticsReport.mockResolvedValueOnce(report).mockReturnValueOnce(
      new Promise<AnalyticsReport>((resolve) => { resolveNext = resolve; })
    );
    render(<AnalyticsDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Guides" }));
    await screen.findByRole("cell", { name: "Guide topic" });
    fireEvent.change(screen.getByLabelText("From (UTC)"), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(screen.getByLabelText("To (UTC)"), {
      target: { value: "2026-11-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show report" }));
    expect(screen.getByRole("cell", { name: "Guide topic" })).toBeDefined();
    expect(screen.getByText(/Showing 2026-11-01 to 2026-11-16/)).toBeDefined();
    await act(async () => resolveNext({
      ...report,
      range: { ...report.range, from: "2026-11-10" },
      guides: [{ ...report.guides[0], title: "Updated guide" }],
    }));
    expect(await screen.findByRole("cell", { name: "Updated guide" })).toBeDefined();
    expect(screen.getByText(/Showing 2026-11-10 to 2026-11-16/)).toBeDefined();
  });

  it("refuses reversed dates without replacing the currently measured report", async () => {
    render(<AnalyticsDashboard />);
    await screen.findByRole("heading", { name: "Discovery" });
    fireEvent.change(screen.getByLabelText("From (UTC)"), {
      target: { value: "2026-11-20" },
    });
    fireEvent.change(screen.getByLabelText("To (UTC)"), {
      target: { value: "2026-11-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show report" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "The start date must not follow the end date."
    );
    await waitFor(() => expect(fetchAnalyticsReport).toHaveBeenCalledTimes(1));
    expect(
      isInaccessible(screen.getByRole("heading", { name: "Discovery" }))
    ).toBe(false);
  });
});

describe("inclusive UTC analytics dates", () => {
  it("accepts one day and 365 days, but refuses 366 days and invalid calendar dates", () => {
    expect(
      analyticsRangeError({ from: "2026-11-16", to: "2026-11-16" })
    ).toBeNull();
    expect(
      analyticsRangeError({ from: "2026-01-01", to: "2026-12-31" })
    ).toBeNull();
    expect(
      analyticsRangeError({ from: "2026-01-01", to: "2027-01-01" })
    ).toMatch(/365/);
    expect(
      analyticsRangeError({ from: "2026-02-30", to: "2026-03-01" })
    ).toMatch(/valid UTC dates/);
  });

  it("defaults to thirty inclusive UTC days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T00:30:00Z"));
    expect(defaultAnalyticsRange()).toEqual({
      from: "2026-10-18",
      to: "2026-11-16",
    });
  });
});
