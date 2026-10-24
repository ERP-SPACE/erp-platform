import type { CategoryItem, ProductItem } from "@erp/contracts";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  Drawer,
  Field,
  Mono,
  PageHeader,
  Select,
  Switch,
  TextInput,
  cn,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Layers, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ApiError, api, call } from "../../lib/api.js";
import { useApiErrorToast } from "../../lib/errors.js";
import {
  categoriesQuery,
  flattenIssues,
  productsQuery,
  qualitiesQuery,
  settingValue,
} from "../../lib/masters.js";
import { can, keys, meQuery, settingsQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/catalogue")({
  validateSearch: z.object({
    category: z.string().optional(),
    product: z.string().optional(),
  }),
  component: CataloguePage,
});

const GST_RATES = ["0", "5", "12", "18", "28"];

function useCatalogueSettings() {
  const { data } = useQuery(settingsQuery);
  return {
    gsms: settingValue<number[]>(data, "catalogue.gsmList", []),
    widths: settingValue<number[]>(data, "catalogue.allowedWidthsIn", []),
    lengths: settingValue<number[]>(data, "catalogue.allowedLengthsM", []),
  };
}

function CataloguePage() {
  const { data: me } = useQuery(meQuery);
  const categories = useQuery(categoriesQuery);
  const qualities = useQuery(qualitiesQuery);
  const products = useQuery(productsQuery);
  const { category, product } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [editCategory, setEditCategory] = useState<CategoryItem | null>(null);
  const [newProduct, setNewProduct] = useState(false);
  const [newQuality, setNewQuality] = useState(false);
  const editable = can(me, "catalogue.manage");

  const rows = useMemo(
    () => (products.data ?? []).filter((p) => !category || p.categoryId === category),
    [products.data, category],
  );
  const selected = product ? products.data?.find((p) => p.id === product) : undefined;
  const missingTax = (categories.data ?? []).filter((c) => c.active && !c.taxReady);

  const columns: ColumnDef<ProductItem, unknown>[] = [
    {
      accessorKey: "name",
      header: "Product",
      cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
    },
    { accessorKey: "qualityName", header: "Quality" },
    { accessorKey: "gsm", header: "GSM", meta: { numeric: true } },
    {
      id: "widths",
      header: "Widths",
      accessorFn: (p) => p.skus.map((s) => s.widthIn).join(" "),
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.row.original.skus.map((s) => (
            <span
              key={s.id}
              className={cn(
                "tnum rounded border px-1.5 py-0.5 text-xs",
                s.active
                  ? "border-border bg-muted text-fg-2"
                  : "border-dashed border-border text-fg-3 line-through",
              )}
            >
              {s.widthIn}″
            </span>
          ))}
          {c.row.original.skus.length === 0 ? (
            <span className="text-xs text-fg-3">No SKUs</span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "defaultLengthM",
      header: "Roll length",
      meta: { numeric: true },
      cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
    },
    {
      accessorKey: "active",
      header: "Status",
      cell: (c) => (c.getValue() ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>),
    },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Catalogue"
        description="Category → quality → GSM → width. Rates are quoted per metre at 44″; other widths derive by ratio."
        breadcrumbs={[{ label: "Masters" }, { label: "Catalogue" }]}
        actions={
          editable ? (
            <Button variant="primary" icon={Plus} onClick={() => setNewProduct(true)}>
              New product
            </Button>
          ) : null
        }
      />

      {missingTax.length ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">HSN required before invoicing:</strong>{" "}
            {missingTax.map((c) => c.name).join(", ")}. Add the HSN code and GST rate to each
            category.
          </p>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid gap-6">
          <Card title="Categories" padded={false}>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => void navigate({ search: {}, replace: true })}
                  className={cn(
                    "flex w-full items-center justify-between border-b border-border px-5 py-3 text-left text-sm hover:bg-muted",
                    !category && "bg-primary-soft text-primary",
                  )}
                >
                  <span className="font-medium">All categories</span>
                  <span className="tnum text-xs text-fg-2">{products.data?.length ?? 0}</span>
                </button>
              </li>
              {(categories.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "flex items-center border-b border-border last:border-b-0",
                    category === c.id && "bg-primary-soft",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void navigate({ search: { category: c.id }, replace: true })}
                    className="flex min-w-0 flex-1 flex-col items-start gap-1 px-5 py-3 text-left hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "text-sm font-medium",
                        category === c.id ? "text-primary" : "text-fg",
                      )}
                    >
                      {c.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
                      <Mono>{c.code}</Mono>
                      <span>·</span>
                      <span className="tnum">
                        {c.productCount} products, {c.skuCount} SKUs
                      </span>
                    </span>
                    {c.taxReady ? (
                      <span className="text-xs text-fg-2">
                        HSN <Mono>{c.hsnCode}</Mono> · GST {c.gstRate}%
                      </span>
                    ) : (
                      <Badge tone="warning">HSN not set</Badge>
                    )}
                  </button>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      iconOnly
                      aria-label={`Edit ${c.name}`}
                      className="mr-3"
                      onClick={() => setEditCategory(c)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card
            title="Qualities"
            actions={
              editable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  onClick={() => setNewQuality(true)}
                >
                  Add
                </Button>
              ) : null
            }
          >
            <div className="flex flex-wrap gap-2">
              {(qualities.data ?? []).map((q) => (
                <Badge key={q.id} tone={q.active ? "primary" : "neutral"} dot={false}>
                  {q.name}
                </Badge>
              ))}
            </div>
          </Card>
        </div>

        <DataTable
          caption="Products"
          data={rows}
          loading={products.isLoading}
          columns={columns}
          getRowId={(p) => p.id}
          selectedId={selected?.id ?? null}
          onRowClick={(p) =>
            void navigate({ search: (s) => ({ ...s, product: p.id }), replace: true })
          }
          searchPlaceholder="Search products, GSM, widths"
          empty={
            <div className="grid justify-items-center gap-2 py-6 text-sm text-fg-3">
              <Layers className="size-6" aria-hidden />
              No products yet{editable ? " — add one with New product." : "."}
            </div>
          }
        />
      </div>

      {editCategory ? (
        <CategoryDialog
          key={editCategory.id}
          category={editCategory}
          onClose={() => setEditCategory(null)}
        />
      ) : null}
      {newProduct ? (
        <NewProductDialog defaultCategory={category} onClose={() => setNewProduct(false)} />
      ) : null}
      {newQuality ? <QualityDialog onClose={() => setNewQuality(false)} /> : null}
      {selected ? (
        <ProductDrawer
          key={`${selected.id}:${selected.version}:${selected.skus.length}`}
          product={selected}
          editable={editable}
          onClose={() =>
            void navigate({ search: (s) => ({ ...s, product: undefined }), replace: true })
          }
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({ category, onClose }: { category: CategoryItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [name, setName] = useState(category.name);
  const [hsn, setHsn] = useState(category.hsnCode ?? "");
  const [gst, setGst] = useState(category.gstRate ?? "");
  const [active, setActive] = useState(category.active);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.PATCH("/api/catalogue/categories/{id}", {
          params: { path: { id: category.id } },
          body: {
            name: name.trim(),
            hsnCode: hsn.trim() || null,
            gstRate: (gst || null) as "18" | null,
            active,
            version: category.version,
          },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: `${name} saved` });
      await queryClient.invalidateQueries({ queryKey: keys.catalogue });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error, keys.catalogue);
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${category.name}`}
      description="HSN and GST rate print on every invoice line of this category."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Save category
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" required error={errors.name}>
          {(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HSN code" hint="4, 6 or 8 digits" error={errors.hsnCode}>
            {(p) => (
              <TextInput
                {...p}
                inputMode="numeric"
                maxLength={8}
                className="font-mono"
                value={hsn}
                onChange={(e) => setHsn(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <Field label="GST rate" error={errors.gstRate}>
            {(p) => (
              <Select
                {...p}
                value={gst || undefined}
                onValueChange={setGst}
                placeholder="Not set"
                options={GST_RATES.map((r) => ({ value: r, label: `${r}%` }))}
              />
            )}
          </Field>
        </div>
        <Switch
          label="Active"
          description="Inactive categories can't get new products."
          checked={active}
          onCheckedChange={setActive}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function QualityDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/catalogue/qualities", {
          body: {
            name: name.trim(),
            aliases: aliases
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean),
          },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: `Quality ${name} added` });
      await queryClient.invalidateQueries({ queryKey: keys.catalogue });
      onClose();
    },
    onError: (error) => onError(error),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add quality"
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length < 2}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Add quality
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Name" required>
          {(p) => (
            <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Also known as" hint="Comma-separated names suppliers use for it">
          {(p) => <TextInput {...p} value={aliases} onChange={(e) => setAliases(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

function NewProductDialog({
  defaultCategory,
  onClose,
}: {
  defaultCategory?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: categories } = useQuery(categoriesQuery);
  const { data: qualities } = useQuery(qualitiesQuery);
  const settings = useCatalogueSettings();
  const [categoryId, setCategory] = useState(defaultCategory ?? "");
  const [qualityId, setQuality] = useState("");
  const [gsm, setGsm] = useState("");
  const [length, setLength] = useState("");
  const [widths, setWidths] = useState<number[]>([44]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      call<ProductItem>(() =>
        api.POST("/api/catalogue/products", {
          body: {
            categoryId,
            qualityId,
            gsm: Number(gsm),
            defaultLengthM: Number(length || settings.lengths[0]),
            widthsIn: widths,
          },
        }),
      ),
    onSuccess: async (product) => {
      toast({
        tone: "success",
        title: `${product.name} added`,
        description: `${product.skus.length} SKUs created`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.catalogue });
      onClose();
      void navigate({ search: (s) => ({ ...s, product: product.id }), replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(flattenIssues(error.fieldErrors()));
      onError(error);
    },
  });
  const ready = categoryId && qualityId && gsm;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New product"
      description="A product is one category, quality and GSM; each width becomes a SKU."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Create product
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          {(p) => (
            <Select
              {...p}
              value={categoryId || undefined}
              onValueChange={setCategory}
              placeholder="Choose"
              options={(categories ?? [])
                .filter((c) => c.active)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
        </Field>
        <Field label="Quality" required>
          {(p) => (
            <Select
              {...p}
              value={qualityId || undefined}
              onValueChange={setQuality}
              placeholder="Choose"
              options={(qualities ?? [])
                .filter((q) => q.active)
                .map((q) => ({ value: q.id, label: q.name }))}
            />
          )}
        </Field>
        <Field label="GSM" required error={errors.gsm}>
          {(p) => (
            <Select
              {...p}
              value={gsm || undefined}
              onValueChange={setGsm}
              placeholder="Choose"
              options={settings.gsms.map((g) => ({ value: String(g), label: `${g} GSM` }))}
            />
          )}
        </Field>
        <Field label="Standard roll length" error={errors.defaultLengthM}>
          {(p) => (
            <Select
              {...p}
              value={length || (settings.lengths[0] ? String(settings.lengths[0]) : undefined)}
              onValueChange={setLength}
              options={settings.lengths.map((l) => ({
                value: String(l),
                label: `${l.toLocaleString("en-IN")} m`,
              }))}
            />
          )}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-fg">Widths</legend>
          <div className="flex flex-wrap gap-4">
            {settings.widths.map((w) => (
              <Checkbox
                key={w}
                label={`${w}″`}
                checked={widths.includes(w)}
                onCheckedChange={(on) =>
                  setWidths(
                    on ? [...widths, w].sort((a, b) => a - b) : widths.filter((x) => x !== w),
                  )
                }
              />
            ))}
          </div>
          {errors.widthsIn ? <p className="mt-1.5 text-xs text-danger">{errors.widthsIn}</p> : null}
        </fieldset>
      </div>
    </Dialog>
  );
}

function ProductDrawer({
  product,
  editable,
  onClose,
}: {
  product: ProductItem;
  editable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const settings = useCatalogueSettings();
  const [length, setLength] = useState(String(product.defaultLengthM));
  const [active, setActive] = useState(product.active);
  const [add, setAdd] = useState<number[]>([]);
  const existing = new Set(product.skus.map((s) => Number(s.widthIn)));
  const missing = settings.widths.filter((w) => !existing.has(w));
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.catalogue });

  const save = useMutation({
    mutationFn: async () => {
      if (Number(length) !== product.defaultLengthM || active !== product.active) {
        await call(() =>
          api.PATCH("/api/catalogue/products/{id}", {
            params: { path: { id: product.id } },
            body: { defaultLengthM: Number(length), active, version: product.version },
          }),
        );
      }
      if (add.length) {
        await call(() =>
          api.POST("/api/catalogue/products/{id}/skus", {
            params: { path: { id: product.id } },
            body: { widthsIn: add },
          }),
        );
      }
    },
    onSuccess: async () => {
      toast({ tone: "success", title: `${product.name} saved` });
      setAdd([]);
      await refresh();
    },
    onError: (error) => onError(error, keys.catalogue),
  });

  const toggleSku = useMutation({
    mutationFn: (sku: ProductItem["skus"][number]) =>
      call(() =>
        api.PATCH("/api/catalogue/skus/{id}", {
          params: { path: { id: sku.id } },
          body: {
            taxRateOverride: (sku.taxRateOverride ?? null) as "18" | null,
            active: !sku.active,
            version: sku.version,
          },
        }),
      ),
    onSuccess: () => refresh(),
    onError: (error) => onError(error, keys.catalogue),
  });

  const dirty =
    Number(length) !== product.defaultLengthM || active !== product.active || add.length > 0;

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={product.name}
      description={`${product.categoryName} · ${product.qualityName} · ${product.gsm} GSM`}
      footer={
        editable ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={!dirty}
              busy={save.isPending}
              onClick={() => save.mutate()}
            >
              Save changes
            </Button>
          </>
        ) : null
      }
    >
      <div className="grid gap-6">
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-fg">SKUs</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {product.skus.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="tnum text-sm font-medium text-fg">{s.widthIn}″</p>
                  <Mono className="text-xs text-fg-3">{s.code}</Mono>
                </div>
                {editable ? (
                  <Switch
                    label={s.active ? "Active" : "Inactive"}
                    checked={s.active}
                    onCheckedChange={() => toggleSku.mutate(s)}
                    disabled={toggleSku.isPending}
                  />
                ) : s.active ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge>Inactive</Badge>
                )}
              </li>
            ))}
          </ul>
          {editable && missing.length ? (
            <div className="grid gap-2">
              <p className="text-sm text-fg-2">Add widths</p>
              <div className="flex flex-wrap gap-4">
                {missing.map((w) => (
                  <Checkbox
                    key={w}
                    label={`${w}″`}
                    checked={add.includes(w)}
                    onCheckedChange={(on) => setAdd(on ? [...add, w] : add.filter((x) => x !== w))}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
        {editable ? (
          <section className="grid gap-4">
            <Field label="Standard roll length">
              {(p) => (
                <Select
                  {...p}
                  value={length}
                  onValueChange={setLength}
                  options={settings.lengths.map((l) => ({
                    value: String(l),
                    label: `${l.toLocaleString("en-IN")} m`,
                  }))}
                />
              )}
            </Field>
            <Switch
              label="Active"
              description="Inactive products can't be ordered."
              checked={active}
              onCheckedChange={setActive}
            />
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
