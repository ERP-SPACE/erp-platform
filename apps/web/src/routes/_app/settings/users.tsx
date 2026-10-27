import type { PermissionCode, PermissionItem, RoleItem, UserItem } from "@erp/contracts";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Switch,
  Tabs,
  TextInput,
  useToast,
} from "@erp/ui";
import { Lock, UserPlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { ApiError, api, call } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import {
  can,
  keys,
  meQuery,
  permissionsQuery,
  rolesQuery,
  usersQuery,
} from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/settings/users")({ component: UsersPage });

function UsersPage() {
  const [tab, setTab] = useState("users");
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      tabs={[
        { value: "users", label: "Users", content: <UsersTab /> },
        { value: "roles", label: "Roles & permissions", content: <RolesTab /> },
      ]}
    />
  );
}

function UsersTab() {
  const { data: users } = useQuery(usersQuery);
  const { data: roles } = useQuery(rolesQuery);
  const { data: me } = useQuery(meQuery);
  const [editing, setEditing] = useState<UserItem | "new" | null>(null);
  const roleName = useMemo(() => new Map(roles?.map((r) => [r.code, r.name])), [roles]);

  const columns = useMemo<ColumnDef<UserItem, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (c) => (
          <span className="flex items-center gap-3">
            <Avatar name={c.getValue() as string} size="sm" />
            <span className="font-medium">{c.getValue() as string}</span>
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: (c) => <span className="text-fg-2">{c.getValue() as string}</span>,
      },
      {
        id: "roles",
        header: "Roles",
        accessorFn: (u) => u.roleCodes.map((c) => roleName.get(c) ?? c).join(", "),
      },
      {
        id: "twoFactor",
        header: "Two-step",
        accessorFn: (u) => (u.twoFactorEnabled ? "On" : "Off"),
        cell: (c) => (
          <Badge tone={c.getValue() === "On" ? "success" : "neutral"}>
            {c.getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "active",
        header: "Status",
        cell: (c) =>
          c.getValue() ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="danger">Deactivated</Badge>
          ),
      },
    ],
    [roleName],
  );

  if (!users || !roles) return null;
  const manage = can(me, "users.manage");

  return (
    <div className="grid gap-4">
      <DataTable
        caption="Users"
        data={users}
        columns={columns}
        getRowId={(u) => u.id}
        onRowClick={manage ? (u) => setEditing(u) : undefined}
        searchPlaceholder="Search users"
        toolbar={
          manage ? (
            <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setEditing("new")}>
              Add user
            </Button>
          ) : null
        }
      />
      {editing ? (
        <UserDialog
          user={editing === "new" ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function UserDialog({
  user,
  roles,
  onClose,
}: {
  user: UserItem | null;
  roles: RoleItem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user?.active ?? true);
  const [roleCodes, setRoleCodes] = useState<string[]>(user?.roleCodes ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      user
        ? call(() =>
            api.PATCH("/api/users/{id}", {
              params: { path: { id: user.id } },
              body: { name, active, roleCodes },
            }),
          )
        : call(() => api.POST("/api/users", { body: { name, email, password, roleCodes } })),
    onSuccess: async () => {
      toast({
        tone: "success",
        title: user ? "User updated" : "User added",
        description: user ? undefined : "Share the temporary password with them in person.",
      });
      await queryClient.invalidateQueries({ queryKey: keys.users });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
      onError(error, keys.users);
    },
  });

  const toggle = (code: string, on: boolean) =>
    setRoleCodes((current) =>
      on ? [...new Set([...current, code])] : current.filter((c) => c !== code),
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={user ? user.name : "Add a user"}
      description={
        user ? user.email : "They sign in with this email and the temporary password you set."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={
              !name || roleCodes.length === 0 || (!user && (!email || password.length < 10))
            }
            onClick={() => save.mutate()}
          >
            {user ? "Save" : "Add user"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Full name" error={errors.name}>
          {(p) => (
            <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          )}
        </Field>
        {!user ? (
          <>
            <Field label="Email" error={errors.email}>
              {(p) => (
                <TextInput
                  {...p}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Temporary password"
              hint="At least 10 characters."
              error={errors.password}
            >
              {(p) => (
                <TextInput
                  {...p}
                  type="text"
                  autoComplete="new-password"
                  className="font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Roles</legend>
          <div className="grid grid-cols-2 gap-2">
            {roles.map((role) => (
              <Checkbox
                key={role.code}
                label={role.name}
                checked={roleCodes.includes(role.code)}
                onCheckedChange={(on) => toggle(role.code, on)}
              />
            ))}
          </div>
          {errors.roleCodes ? <p className="mt-1 text-xs text-danger">{errors.roleCodes}</p> : null}
        </fieldset>
        {user ? (
          <Switch label="Account active" checked={active} onCheckedChange={setActive} />
        ) : null}
      </div>
    </Dialog>
  );
}

function RolesTab() {
  const { data: roles } = useQuery(rolesQuery);
  const { data: permissions } = useQuery(permissionsQuery);
  const { data: me } = useQuery(meQuery);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [changes, setChanges] = useState<Record<string, Set<string>>>({});
  const editable = can(me, "roles.manage");

  const save = useMutation({
    mutationFn: async () => {
      for (const [roleId, codes] of Object.entries(changes)) {
        const role = roles!.find((r) => r.id === roleId)!;
        await call(() =>
          api.PUT("/api/roles/{id}/permissions", {
            params: { path: { id: roleId } },
            body: { permissionCodes: [...codes] as PermissionCode[], version: role.version },
          }),
        );
      }
    },
    onSuccess: async () => {
      toast({ tone: "success", title: "Permissions saved" });
      setChanges({});
      await queryClient.invalidateQueries({ queryKey: keys.roles });
    },
    onError: (error) => onError(error, keys.roles),
  });

  if (!roles || !permissions) return null;
  const modules = [...new Set(permissions.map((p) => p.module))];
  const granted = (role: RoleItem) => changes[role.id] ?? new Set(role.permissionCodes);
  const flip = (role: RoleItem, code: string, on: boolean) => {
    const next = new Set(granted(role));
    if (on) next.add(code);
    else next.delete(code);
    setChanges({ ...changes, [role.id]: next });
  };

  return (
    <div className="grid gap-4">
      <Card
        padded={false}
        title="Permission matrix"
        description="Owner always has every permission. Ticked items marked with a lock ask for the password again."
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Permission matrix</caption>
            <thead>
              <tr className="border-b border-border bg-muted">
                <th scope="col" className="h-10 px-5 text-left text-xs font-medium text-fg-3">
                  Permission
                </th>
                {roles.map((role) => (
                  <th
                    key={role.id}
                    scope="col"
                    className="h-10 px-2 text-center text-xs font-medium text-fg-3"
                  >
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => (
                <PermissionGroup
                  key={module}
                  module={module}
                  permissions={permissions.filter((p) => p.module === module)}
                  roles={roles}
                  granted={granted}
                  flip={flip}
                  editable={editable}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editable ? (
        <div className="flex items-center justify-end gap-3">
          {Object.keys(changes).length ? (
            <span className="text-xs text-fg-2">
              Unsaved changes to {Object.keys(changes).length} role(s)
            </span>
          ) : null}
          <Button
            variant="secondary"
            disabled={!Object.keys(changes).length}
            onClick={() => setChanges({})}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={!Object.keys(changes).length}
            onClick={() => save.mutate()}
          >
            Save permissions
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PermissionGroup({
  module,
  permissions,
  roles,
  granted,
  flip,
  editable,
}: {
  module: string;
  permissions: PermissionItem[];
  roles: RoleItem[];
  granted: (role: RoleItem) => Set<string>;
  flip: (role: RoleItem, code: string, on: boolean) => void;
  editable: boolean;
}) {
  return (
    <>
      <tr>
        <th
          colSpan={roles.length + 1}
          scope="colgroup"
          className="label-caps border-b border-border px-5 pb-2 pt-4 text-left"
        >
          {module}
        </th>
      </tr>
      {permissions.map((permission) => (
        <tr
          key={permission.code}
          className="border-b border-border last:border-b-0 hover:bg-muted/50"
        >
          <th scope="row" className="px-5 py-2.5 text-left font-normal">
            <span className="text-fg">{permission.description}</span>
            {permission.stepUp ? (
              <Lock className="ml-2 inline size-3.5 text-fg-3" aria-label="Asks for password" />
            ) : null}
          </th>
          {roles.map((role) => (
            <td key={role.id} className="px-2 text-center">
              <span className="inline-flex">
                <Checkbox
                  checked={role.locked || granted(role).has(permission.code)}
                  disabled={!editable || role.locked}
                  onCheckedChange={(on) => flip(role, permission.code, on)}
                />
              </span>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
