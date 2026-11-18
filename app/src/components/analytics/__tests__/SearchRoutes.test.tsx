// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ComponentType, MouseEventHandler, ReactNode } from "react";
import { Route as BrowseRoute } from "@/routes/browse";
import { Route as HomeRoute } from "@/routes/index";

const { browse, navigate, getSession, routerState } = vi.hoisted(() => {
  vi.stubEnv("VITE_API_BASE", "https://analytics.test");

  return {
    browse: { search: {} },
    navigate: vi.fn(),
    getSession: vi.fn(),
    routerState: {
      status: "idle",
      location: { state: {} },
    },
  };
});
vi.mock("@/lib/authContext", () => ({ useAuth: () => ({ loading: false }) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession } } }));
vi.mock("@/routes/objectives/$slug/index", () => ({
  Route: { to: "/objectives/$slug" },
}));
vi.mock("@/routes/guides/$slug/index", () => ({
  Route: { to: "/guides/$slug" },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: unknown) => ({
    options,
    fullPath: path,
    useSearch: () => browse.search,
    useLoaderData: () =>
      path === "/"
        ? { subjects: [], subjectsFailed: false }
        : {
            guides: {
              found: 1,
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  slug: "guide-result",
                  title: "Guide result",
                  author: "author",
                  summary: "A guide.",
                  created_at: "2026-11-16T00:00:00Z",
                  duration_minutes: 3,
                  tags: [],
                },
              ],
            },
            objectives: {
              found: 1,
              items: [
                {
                  id: "00000000-0000-4000-8000-000000000002",
                  slug: "objective-result",
                  title: "Objective result",
                  summary: "An objective.",
                  curator: "curator",
                  created_at: "2026-11-16T00:00:00Z",
                  duration_minutes: 3,
                  guides_total: 1,
                  featured_sub_objective: [],
                },
              ],
            },
            error: null,
          },
  }),
  useNavigate: () => navigate,
  useRouterState: ({
    select,
  }: {
    select: (state: typeof routerState) => unknown;
  }) => select(routerState),
  Link: ({
    to,
    params,
    children,
    onClick,
    className,
  }: {
    to: string;
    params?: { slug: string };
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    className?: string;
  }) => (
    <a
      href={to.replace("$slug", params?.slug ?? "")}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

const BrowsePage = BrowseRoute.options.component as ComponentType;
const HomePage = HomeRoute.options.component as ComponentType;
let requests: Array<Request>;

beforeEach(() => {
  requests = [];
  browse.search = {};
  routerState.location.state = {};
  routerState.status = "idle";
  navigate.mockReset();
  navigate.mockResolvedValue(undefined);
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => vi.unstubAllEnvs());

describe("search route interactions", () => {
  it("records nonempty home submissions without sending the query or counting empty submits", async () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "private search text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    const body = await requests[0].json();

    expect(body.events[0].name).toBe("search_submitted");
    expect(JSON.stringify(body)).not.toContain("private search text");
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/browse",
        state: { searchSubmissionId: body.events[0].event_id },
      })
    );
  });

  it("does not count initial browse rendering as a search, but counts each explicit resubmission", async () => {
    browse.search = { q: "existing query" };
    render(<BrowsePage />);
    expect(requests).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const events = await Promise.all(
      requests.map(async (request) => (await request.json()).events[0])
    );

    expect(events.map((event) => event.name)).toEqual([
      "search_submitted",
      "search_submitted",
    ]);
    expect(events[0].event_id).not.toBe(events[1].event_id);
    expect(JSON.stringify(events)).not.toContain("existing query");
  });

  it("records selected guide-base and objective IDs through the real result cards", async () => {
    browse.search = { q: "private query" };
    render(<BrowsePage />);
    fireEvent.click(screen.getByRole("link", { name: /Guide result/ }));
    fireEvent.click(screen.getByRole("link", { name: /Objective result/ }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const events = await Promise.all(
      requests.map(async (request) => (await request.json()).events[0])
    );

    expect(events).toEqual([
      {
        event_id: expect.any(String),
        name: "search_result_selected",
        source: "search",
        entity_type: "guide",
        guide_base_id: "00000000-0000-4000-8000-000000000001",
        result_count: 2,
      },
      {
        event_id: expect.any(String),
        name: "search_result_selected",
        source: "search",
        entity_type: "objective",
        objective_id: "00000000-0000-4000-8000-000000000002",
        result_count: 2,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("private query");
  });

  it("does not classify ordinary browse selections as search results", () => {
    render(<BrowsePage />);
    fireEvent.click(screen.getByRole("link", { name: /Guide result/ }));
    fireEvent.click(screen.getByRole("link", { name: /Objective result/ }));

    expect(requests).toHaveLength(0);
  });
});
