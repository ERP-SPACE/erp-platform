import { SETTINGS, type SettingItem, isSettingKey } from "@erp/contracts";
import { Button, EmptyState, Rule, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ReasonField } from "../../../components/reason-field.js";
import {
  type Draft,
  SettingEditor,
  fromDraft,
  summarise,
  toDraft,
} from "../../../components/setting-editor.js";
import { ApiError, api, call, reasonHeader } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import { can, keys, meQuery, settingsQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/settings/general")({ component: GeneralSettings });

function GeneralSettings() {
  const { data: settings } = useQuery(settingsQuery);
  const { data: me } = useQuery(meQuery);
  const [editing, setEditing] = useState<string | null>(null);
  if (!settings) return null;
  if (!settings.length) return <EmptyState title="No settings yet." />;

  const groups = [...new Set(settings.map((s) => s.group))];
  return (
    <div className="grid gap-10">
      {groups.map((group) => (
        <section key={group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className="border-b border-rule-strong pb-2 text-lg">
            {group}
          </h2>
          <ul>
            {settings
              .filter((s) => s.group === group)
              .map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  editable={can(me, "settings.update")}
                  open={editing === setting.key}
                  onOpen={() => setEditing(setting.key)}
                  onClose={() => setEditing(null)}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SettingRow({
  setting,
  editable,
  open,
  onOpen,
  onClose,
}: {
  setting: SettingItem;
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const schema = isSettingKey(setting.key) ? SETTINGS[setting.key].schema : null;
  const [draft, setDraft] = useState<Draft>(() => (schema ? toDraft(schema, setting.value) : ""));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (value: unknown) =>
      call(() =>
        api.PATCH("/api/settings/{key}", {
          params: { path: { key: setting.key } },
          headers: reasonHeader(reason),
          body: { value, version: setting.version },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "positive", title: `${setting.label} saved` });
      setReason("");
      onClose();
      await queryClient.invalidateQueries({ queryKey: keys.settings });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      onError(error, keys.settings);
    },
  });

  const submit = () => {
    if (!schema) return;
    const value = fromDraft(schema, draft);
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [["value", ...i.path].join("."), i.message]),
        ),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <li className="border-b border-rule py-4" data-setting={setting.key}>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
        <div className="min-w-0">
          <p className="font-medium text-ink">{setting.label}</p>
          {!open ? (
            <p className="tnum mt-0.5 truncate text-sm text-ink-2">{summarise(setting.value)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink-3">
            {setting.updatedByName
              ? `${setting.updatedByName}, ${dateTime(setting.updatedAt)}`
              : "Default"}
          </span>
          {editable && !open ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(schema ? toDraft(schema, setting.value) : "");
                setErrors({});
                onOpen();
              }}
            >
              Edit
            </Button>
          ) : null}
        </div>
      </div>
      {open && schema ? (
        <form
          className="mt-4 grid gap-5 rounded-xs border border-rule bg-sheet p-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SettingEditor
            schema={schema}
            draft={draft}
            onChange={setDraft}
            label={setting.label}
            errors={errors}
          />
          <Rule />
          <ReasonField value={reason} onChange={setReason} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
