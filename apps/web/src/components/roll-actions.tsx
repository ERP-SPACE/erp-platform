import { Button, Dialog, Field, NumberInput, useToast } from "@erp/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, call, reasonHeader } from "../lib/api.js";
import { useApiErrorToast } from "../lib/errors.js";
import { printLabels } from "../lib/purchase.js";
import { keys } from "../lib/queries.js";
import { ReasonField } from "./reason-field.js";

/** Reprint, scrap and length correction share this reason-first dialog. */
export function RollActionDialog({
  action,
  rollIds,
  roll,
  onClose,
}: {
  action: "reprint" | "scrap" | "length";
  rollIds: string[];
  roll?: { id: string; currentLengthM: number; version: number };
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [length, setLength] = useState(roll ? String(roll.currentLengthM) : "");
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const run = useMutation({
    mutationFn: async () => {
      if (action === "reprint") return printLabels({ rollIds, reprint: true }, reason);
      if (action === "scrap") {
        return call(() =>
          api.POST("/api/rolls/scrap", { headers: reasonHeader(reason), body: { rollIds } }),
        );
      }
      return call(() =>
        api.PATCH("/api/rolls/{id}/length", {
          params: { path: { id: roll!.id } },
          headers: reasonHeader(reason),
          body: { currentLengthM: Number(length), version: roll!.version },
        }),
      );
    },
    onSuccess: async () => {
      toast({
        tone: "success",
        title:
          action === "reprint"
            ? "Labels reprinted"
            : action === "scrap"
              ? `${rollIds.length} roll${rollIds.length > 1 ? "s" : ""} scrapped`
              : "Length corrected",
      });
      await queryClient.invalidateQueries({ queryKey: keys.inventory });
      onClose();
    },
    onError: (e) => onError(e, keys.inventory),
  });
  const title = { reprint: "Reprint labels", scrap: "Scrap rolls", length: "Correct roll length" }[
    action
  ];
  const description = {
    reprint: `${rollIds.length} label${rollIds.length > 1 ? "s" : ""}. Every reprint is logged.`,
    scrap: "The rolls leave stock at their landed cost. You may be asked to confirm your password.",
    length:
      "Only for a mis-keyed supplier length on an uncut roll. Its value follows the new length.",
  }[action];
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === "scrap" ? "danger" : "primary"}
            disabled={!reason.trim() || (action === "length" && !Number(length))}
            busy={run.isPending}
            onClick={() => run.mutate()}
          >
            {title}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {action === "length" ? (
          <Field label="Correct length">
            {(p) => (
              <NumberInput
                {...p}
                decimals={0}
                suffix="m"
                value={length}
                onValueChange={setLength}
              />
            )}
          </Field>
        ) : null}
        <ReasonField value={reason} onChange={setReason} required />
      </div>
    </Dialog>
  );
}
