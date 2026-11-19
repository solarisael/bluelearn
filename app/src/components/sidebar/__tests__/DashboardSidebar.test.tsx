// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  DashboardSidebar,
  DashboardTabs,
} from "@/components/sidebar/DashboardSidebar";

const { auth } = vi.hoisted(() => ({
  auth: { roles: [] as Array<string>, loading: false, rolesLoading: false },
}));
vi.mock("@/lib/authContext", () => ({ useAuth: () => auth }));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/dashboard/analytics" } }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  auth.loading = false;
  auth.rolesLoading = false;
});

for (const [name, Component] of [
  ["desktop sidebar", DashboardSidebar],
  ["mobile tabs", DashboardTabs],
] as const) {
  describe(name, () => {
    it("offers analytics only to administrators", () => {
      auth.roles = ["admin"];
      render(<Component />);

      expect(
        screen.getByRole("link", { name: "Analytics" }).getAttribute("href")
      ).toBe("/dashboard/analytics");
      expect(
        document.body.contains(screen.getByRole("link", { name: "Members" }))
      ).toBe(true);
      expect(
        document.body.contains(
          screen.getByRole("link", { name: "Verifier Assignments" })
        )
      ).toBe(true);
    });

    it("preserves assignment access without exposing admin links to lead verifiers", () => {
      auth.roles = ["lead-verifier"];
      render(<Component />);

      expect(
        document.body.contains(
          screen.getByRole("link", { name: "Verifier Assignments" })
        )
      ).toBe(true);
      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Roles" })).toBeNull();
    });

    it("hides stale administrator roles while the next identity resolves", () => {
      auth.roles = ["admin"];
      auth.rolesLoading = true;
      const view = render(<Component />);

      expect(screen.queryByRole("link")).toBeNull();
      auth.rolesLoading = false;
      auth.loading = true;
      view.rerender(<Component />);

      expect(screen.queryByRole("link")).toBeNull();
    });

    it("offers no dashboard links before roles resolve or for ordinary members", () => {
      auth.roles = [];
      render(<Component />);

      expect(screen.queryByRole("link")).toBeNull();
    });
  });
}
