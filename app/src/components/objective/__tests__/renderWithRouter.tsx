import { render } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { parseObjectiveGuideSearch } from "@/lib/objectiveSnapshot";

export async function renderWithRouter(content: ReactNode) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => content,
  });
  const guide = createRoute({
    getParentRoute: () => root,
    path: "/guides/$slug",
    validateSearch: parseObjectiveGuideSearch,
  });
  const variant = createRoute({
    getParentRoute: () => root,
    path: "/guides/$slug/$variantSlug",
    validateSearch: parseObjectiveGuideSearch,
  });
  const objective = createRoute({
    getParentRoute: () => root,
    path: "/objectives/$slug",
  });
  const router = createRouter({
    routeTree: root.addChildren([index, guide, variant, objective]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();

  return render(<RouterProvider router={router} />);
}
