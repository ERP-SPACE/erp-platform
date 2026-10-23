import { useToast } from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ApiError } from "./api.js";
import { dateTime } from "./format.js";

/**
 * Standard reaction to a failed mutation: version conflicts offer a reload, everything else
 * shows the server's message. Field-level issues are left to the form (ApiError.fieldErrors()).
 */
export function useApiErrorToast() {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useCallback(
    (error: unknown, reloadKey?: readonly unknown[]) => {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") {
        const when = error.problem.current?.updatedAt;
        toast({
          tone: "caution",
          title: "Someone else changed this first",
          description: when
            ? `Saved at ${dateTime(when)}. Reload to see their version, then re-apply yours.`
            : undefined,
          action: reloadKey
            ? {
                label: "Reload",
                onClick: () => void queryClient.invalidateQueries({ queryKey: reloadKey }),
              }
            : undefined,
        });
        return;
      }
      if (
        error instanceof ApiError &&
        error.code === "VALIDATION_ERROR" &&
        error.problem.issues?.length
      ) {
        toast({
          tone: "critical",
          title: error.problem.title,
          description: error.problem.issues.map((i) => i.message).join(" · "),
        });
        return;
      }
      toast({
        tone: "critical",
        title: error instanceof ApiError ? error.problem.title : "Something went wrong",
      });
    },
    [toast, queryClient],
  );
}
