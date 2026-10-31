import { REPORT_SECTIONS } from "@erp/contracts";
import { Badge, Button, Card, PageHeader, SearchInput, Skeleton, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Clock, Radio, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { SECTION_LABEL, asOfLabel, catalogueQuery, reportKeys } from "../../../lib/reports.js";

export const Route = createFileRoute("/_app/reports/")({ component: ReportsIndex });

/** Every PRD §9 report the user may open, grouped as the PRD groups them. */
function ReportsIndex() {
  const { data, isLoading } = useQuery(catalogueQuery);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = useMutation({
    mutationFn: () =>
      call<{ refreshed: boolean; asOf: string | null }>(() => api.POST("/api/reports/refresh", {})),
    onSuccess: async (r) => {
      toast({
        tone: "success",
        title: r.refreshed ? "Figures refreshed" : "Figures are already up to date",
        description: asOfLabel(r.asOf) ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: reportKeys.all });
    },
    onError: (e) => onError(e),
  });
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reports"
        description={`Operations, sales, purchase, credit and profitability (PRD §9)${data?.asOf ? ` · figures ${asOfLabel(data.asOf)}, refreshed every 3 minutes in business hours` : ""}.`}
        breadcrumbs={[{ label: "Reports" }]}
        actions={
          <>
            <Button
              variant="secondary"
              icon={RefreshCw}
              busy={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              Refresh now
            </Button>
            <div className="w-64">
              <SearchInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a report"
                aria-label="Find a report"
              />
            </div>
          </>
        }
      />
      {isLoading ? <Skeleton className="h-64" /> : null}
      <div className="grid items-start gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        {REPORT_SECTIONS.map((section) => {
          const reports = (data?.reports ?? []).filter(
            (r) => r.section === section && match(`${r.title} ${r.description}`),
          );
          const linked = (data?.linked ?? []).filter(
            (l) => l.section === section && match(l.title),
          );
          if (!reports.length && !linked.length) return null;
          return (
            <Card key={section} title={SECTION_LABEL[section]} padded={false}>
              <ul>
                {reports.map((r) => (
                  <li key={r.id} className="border-b border-border last:border-b-0">
                    <Link
                      to="/reports/$reportId"
                      params={{ reportId: r.id }}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{r.title}</span>
                        <span className="block text-xs text-fg-2">{r.description}</span>
                      </span>
                      {r.source === "live" ? (
                        <Badge tone="success">
                          <Radio className="size-3" aria-hidden /> Live
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot={false}>
                          <Clock className="size-3" aria-hidden /> 3 min
                        </Badge>
                      )}
                      <ChevronRight className="size-4 text-fg-3" aria-hidden />
                    </Link>
                  </li>
                ))}
                {linked.map((l) => (
                  <li key={l.href} className="border-b border-border last:border-b-0">
                    <Link
                      to={l.href}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{l.title}</span>
                        <span className="block text-xs text-fg-2">In Collections</span>
                      </span>
                      <Badge tone="success">
                        <Radio className="size-3" aria-hidden /> Live
                      </Badge>
                      <ChevronRight className="size-4 text-fg-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
