import { ToastProvider } from "@erp/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StepUpProvider } from "./components/step-up.js";
import { queryClient } from "./lib/queries.js";
import { routeTree } from "./routeTree.gen.js";
import "./styles.css";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StepUpProvider>
          <RouterProvider router={router} />
        </StepUpProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
