// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  SearchTelemetry,
  beginSearchSubmission,
} from "@/components/analytics/SearchTelemetry";

const { auth, getSession } = vi.hoisted(() => {
  vi.stubEnv("VITE_API_BASE", "https://analytics.test");

  return { auth: { loading: false }, getSession: vi.fn() };
});
vi.mock("@/lib/authContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));

let requests: Array<Request>;
let visible = true;

beforeEach(() => {
  requests = [];
  visible = true;
  auth.loading = false;
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null } });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        Response.json({ accepted: 1, duplicates: 0, enabled: true })
      );
    })
  );
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visible ? "visible" : "hidden"
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => vi.unstubAllEnvs());

async function events() {
  return Promise.all(
    requests.map(async (request) => (await request.clone().json()).events[0])
  );
}

describe("explicit search intents", () => {
  it("records each explicit submit immediately, even if navigation never finishes", async () => {
    const first = beginSearchSubmission();
    const second = beginSearchSubmission();
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(first).not.toBe(second);
    expect(await events()).toEqual([
      { event_id: first, name: "search_submitted", source: "search" },
      { event_id: second, name: "search_submitted", source: "search" },
    ]);
  });

  it("does not count initial render, direct search URLs, or pagination as submissions", async () => {
    const view = render(
      <SearchTelemetry resultCount={0} failed={false} pending={false} />
    );
    view.rerender(
      <SearchTelemetry
        submissionId="unregistered-history-marker"
        resultCount={0}
        failed={false}
        pending={false}
      />
    );
    fireEvent(document, new Event("visibilitychange"));

    expect(await events()).toEqual([]);
  });

  it("waits for auth, settled navigation, and visibility before one zero-result event", async () => {
    auth.loading = true;
    visible = false;
    const submissionId = beginSearchSubmission();
    const view = render(
      <SearchTelemetry
        submissionId={submissionId}
        resultCount={0}
        failed={false}
        pending={true}
      />
    );
    await waitFor(() => expect(requests).toHaveLength(1));

    auth.loading = false;
    view.rerender(
      <SearchTelemetry
        submissionId={submissionId}
        resultCount={0}
        failed={false}
        pending={false}
      />
    );
    expect(requests).toHaveLength(1);
    visible = true;
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(requests).toHaveLength(2));

    visible = false;
    fireEvent(document, new Event("visibilitychange"));
    visible = true;
    fireEvent(document, new Event("visibilitychange"));
    view.unmount();
    render(
      <SearchTelemetry
        submissionId={submissionId}
        resultCount={0}
        failed={false}
        pending={false}
      />
    );
    const delivered = await events();

    expect(delivered.map((event) => event.name)).toEqual([
      "search_submitted",
      "search_zero_results",
    ]);
    expect(delivered[1].result_count).toBe(0);
    expect(delivered[0].event_id).not.toBe(delivered[1].event_id);
    expect(Object.keys(delivered[1]).sort()).toEqual([
      "event_id",
      "name",
      "result_count",
      "source",
    ]);
  });

  it("does not report failed loads or nonzero results as zero results", async () => {
    const failedId = beginSearchSubmission();
    const successId = beginSearchSubmission();
    render(
      <>
        <SearchTelemetry
          submissionId={failedId}
          resultCount={0}
          failed={true}
          pending={false}
        />
        <SearchTelemetry
          submissionId={successId}
          resultCount={8}
          failed={false}
          pending={false}
        />
      </>
    );
    await waitFor(() => expect(requests).toHaveLength(2));

    expect((await events()).map((event) => event.name)).toEqual([
      "search_submitted",
      "search_submitted",
    ]);
  });
});
