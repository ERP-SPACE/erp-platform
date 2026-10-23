import { EmptyState } from "@erp/ui";
import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl py-24">
      <EmptyState
        title="This page isn't in the ledger."
        hint="The link may be old, or the section arrives in a later stage."
        action={
          <Link to="/" className="text-sm text-accent underline-offset-4 hover:underline">
            Back to Today
          </Link>
        }
      />
    </div>
  ),
});
