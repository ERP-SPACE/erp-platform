import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Shell } from "../components/shell.js";
import { ApiError } from "../lib/api.js";
import { meQuery } from "../lib/queries.js";

/** Authenticated layout: signed-out → /login; Owner without TOTP → /setup-2fa (ADR-0021). */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      // fetchQuery, not ensureQueryData: after sign-in or TOTP enrolment the cached /me is
      // invalidated, and the guard must see the fresh value, not the stale one.
      const me = await context.queryClient.fetchQuery(meQuery);
      if (me.totpEnrolmentRequired) throw redirect({ to: "/setup-2fa" });
      return { me };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/login", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const { me } = Route.useRouteContext();
  return (
    <Shell me={me}>
      <Outlet />
    </Shell>
  );
}
