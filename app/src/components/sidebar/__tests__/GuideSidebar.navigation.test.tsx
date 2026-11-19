// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { GuideSidebar } from "@/components/sidebar/GuideSidebar";
import { parseObjectiveGuideSearch } from "@/lib/objectiveSnapshot";

afterEach(cleanup);

it("keeps objective context and attribution when a reader jumps to a heading", async () => {
  const root = createRootRoute({ component: Outlet });
  const guide = createRoute({
    getParentRoute: () => root,
    path: "/guides/$slug/$variantSlug",
    validateSearch: parseObjectiveGuideSearch,
    component: () => (
      <GuideSidebar
        slug="loops"
        guide={{
          slug: "loops",
          variant_slug: "original",
          title: "Loops",
          author: null,
          knowledge_type: "theoretical",
          summary: null,
          body: "## Loop boundaries\n\nStop at the boundary.",
          duration_minutes: 1,
          created_at: "2026-11-16T00:00:00Z",
          tags: [],
          prerequisites: [],
          disclaimers: [],
        }}
      />
    ),
  });
  const history = createMemoryHistory({
    initialEntries: [
      "/guides/loops/original?objective=programming&target=target-id&revision=revision-id",
    ],
  });
  history.replace(history.location.href, { analyticsSource: "objective" });
  const router = createRouter({
    routeTree: root.addChildren([guide]),
    history,
  });
  await router.load();
  render(<RouterProvider router={router} />);

  const heading = await screen.findByRole("link", { name: "Loop boundaries" });
  fireEvent.click(heading);

  await waitFor(() =>
    expect(router.state.location.hash).toBe("loop-boundaries")
  );
  expect(router.state.location.pathname).toBe("/guides/loops/original");
  expect(router.state.location.search).toEqual({
    objective: "programming",
    target: "target-id",
    revision: "revision-id",
  });
  expect(router.state.location.state.analyticsSource).toBe("objective");
});
