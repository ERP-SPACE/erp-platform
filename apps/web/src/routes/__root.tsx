import { Button, Card, EmptyState } from "@erp/ui";
import type { QueryClient } from "@tanstack/react-query";
import { Link, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { AlertTriangle, SearchX } from "lucide-react";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-4 py-24">
      <Card padded={false}>
        <EmptyState
          icon={SearchX}
          title="Page not found"
          hint="The link may be old, or the section arrives in a later stage."
          action={
            <Button asChild variant="primary">
              <Link to="/">Back to dashboard</Link>
            </Button>
          }
        />
      </Card>
    </div>
  ),
  // Last line of defence: an unexpected error shows a recoverable message instead of a blank page.
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-xl px-4 py-24">
      <Card padded={false}>
        <EmptyState
          icon={AlertTriangle}
          title="Something went wrong on this page"
          hint={error instanceof Error ? error.message : "An unexpected error occurred."}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>
                Try again
              </Button>
              <Button asChild variant="primary">
                <Link to="/">Back to dashboard</Link>
              </Button>
            </div>
          }
        />
      </Card>
    </div>
  ),
});
