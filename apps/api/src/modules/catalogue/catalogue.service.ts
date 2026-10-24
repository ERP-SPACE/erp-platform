import type { CategoryItem, ProductItem, SkuItem } from "@erp/contracts";
import { type Tx, categories, products, qualities, skus } from "@erp/db";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { actor } from "../../common/context.js";
import { trimDecimal } from "../../common/decimal.js";
import { notFound, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import { SettingsService } from "../settings/settings.service.js";
import type {
  AddSkusDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateQualityDto,
  ProductListQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateQualityDto,
  UpdateSkuDto,
} from "./catalogue.dto.js";

/** "44.00" → "44", "44.50" → "44.5" — widths print without trailing zeros. */
export function formatWidth(width: string | number): string {
  return typeof width === "number" ? String(width) : trimDecimal(width);
}

export function productName(category: string, quality: string, gsm: number): string {
  return `${category} ${quality} ${gsm} GSM`;
}

/** Display names (and category names) for a set of product ids. */
export async function loadProductNames(
  db: UnitOfWork["db"] | Tx,
  ids: string[],
): Promise<Map<string, { name: string; categoryName: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: products.id,
      gsm: products.gsm,
      categoryName: categories.name,
      qualityName: qualities.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(qualities, eq(qualities.id, products.qualityId))
    .where(inArray(products.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [
      r.id,
      { name: productName(r.categoryName, r.qualityName, r.gsm), categoryName: r.categoryName },
    ]),
  );
}

/**
 * Catalogue (PRD §5.1): Category → Quality → GSM → Width. Widths, lengths and GSMs must come from
 * Settings (CLAUDE.md rule 9). HSN/GST may be blank until entered; such categories are flagged.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
  ) {}

  // ── categories ─────────────────────────────────────────────────────────

  async listCategories(): Promise<CategoryItem[]> {
    const rows = await this.uow.db
      .select({
        category: categories,
        productCount: sql<number>`(SELECT count(*)::int FROM products p WHERE p.category_id = categories.id)`,
        skuCount: sql<number>`(SELECT count(*)::int FROM skus s JOIN products p ON p.id = s.product_id WHERE p.category_id = categories.id)`,
      })
      .from(categories)
      .where(eq(categories.companyId, actor().companyId))
      .orderBy(asc(categories.name));
    return rows.map((r) => toCategoryItem(r.category, r.productCount, r.skuCount));
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryItem> {
    const row = await this.uow.run(async (tx) => {
      const [created] = await tx
        .insert(categories)
        .values({
          companyId: actor().companyId,
          ...dto,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      this.changed({ categoryId: created!.id });
      return created!;
    });
    return toCategoryItem(row, 0, 0);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryItem> {
    const { version, ...patch } = dto;
    await this.uow.run(async (tx) => {
      await updateVersioned(tx, categories, this.ownCategory(id), version, patch, "Category");
      this.changed({ categoryId: id });
    });
    const item = (await this.listCategories()).find((c) => c.id === id);
    if (!item) throw notFound("Category");
    return item;
  }

  // ── qualities ──────────────────────────────────────────────────────────

  async listQualities() {
    const rows = await this.uow.db
      .select()
      .from(qualities)
      .where(eq(qualities.companyId, actor().companyId))
      .orderBy(asc(qualities.name));
    return rows.map(toQualityItem);
  }

  async createQuality(dto: CreateQualityDto) {
    return this.uow.run(async (tx) => {
      const [row] = await tx
        .insert(qualities)
        .values({
          companyId: actor().companyId,
          name: dto.name,
          aliases: dto.aliases,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      this.changed({ qualityId: row!.id });
      return toQualityItem(row!);
    });
  }

  async updateQuality(id: string, dto: UpdateQualityDto) {
    const { version, ...patch } = dto;
    return this.uow.run(async (tx) => {
      const row = await updateVersioned(
        tx,
        qualities,
        and(eq(qualities.id, id), eq(qualities.companyId, actor().companyId))!,
        version,
        patch,
        "Quality",
      );
      this.changed({ qualityId: id });
      return toQualityItem(row);
    });
  }

  // ── products & SKUs ────────────────────────────────────────────────────

  async listProducts(query: Partial<ProductListQueryDto> = {}): Promise<ProductItem[]> {
    const filters = [eq(products.companyId, actor().companyId)];
    if (query.categoryId) filters.push(eq(products.categoryId, query.categoryId));
    if (query.qualityId) filters.push(eq(products.qualityId, query.qualityId));
    if (query.active === "true") filters.push(eq(products.active, true));
    if (query.active === "false") filters.push(eq(products.active, false));
    return this.loadProducts(this.uow.db, and(...filters)!);
  }

  async getProduct(id: string): Promise<ProductItem> {
    const [item] = await this.loadProducts(
      this.uow.db,
      and(eq(products.id, id), eq(products.companyId, actor().companyId))!,
    );
    if (!item) throw notFound("Product");
    return item;
  }

  async createProduct(dto: CreateProductDto): Promise<ProductItem> {
    await this.assertAllowed({ gsm: dto.gsm, lengthM: dto.defaultLengthM, widths: dto.widthsIn });
    const companyId = actor().companyId;
    const id = await this.uow.run(async (tx) => {
      const [category] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, dto.categoryId), eq(categories.companyId, companyId)));
      const [quality] = await tx
        .select()
        .from(qualities)
        .where(and(eq(qualities.id, dto.qualityId), eq(qualities.companyId, companyId)));
      if (!category) throw notFound("Category");
      if (!quality) throw notFound("Quality");
      const [product] = await tx
        .insert(products)
        .values({
          companyId,
          categoryId: category.id,
          qualityId: quality.id,
          gsm: dto.gsm,
          defaultLengthM: dto.defaultLengthM,
          createdBy: actor().userId,
          updatedBy: actor().userId,
        })
        .returning();
      await this.insertSkus(tx, product!, category.code, quality.name, dto.widthsIn);
      this.changed({ productId: product!.id });
      return product!.id;
    });
    return this.getProduct(id);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductItem> {
    await this.assertAllowed({ lengthM: dto.defaultLengthM });
    const { version, ...patch } = dto;
    await this.uow.run(async (tx) => {
      await updateVersioned(
        tx,
        products,
        and(eq(products.id, id), eq(products.companyId, actor().companyId))!,
        version,
        patch,
        "Product",
      );
      this.changed({ productId: id });
    });
    return this.getProduct(id);
  }

  async addSkus(productId: string, dto: AddSkusDto): Promise<ProductItem> {
    await this.assertAllowed({ widths: dto.widthsIn });
    const companyId = actor().companyId;
    await this.uow.run(async (tx) => {
      const [row] = await tx
        .select({ product: products, categoryCode: categories.code, qualityName: qualities.name })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .innerJoin(qualities, eq(qualities.id, products.qualityId))
        .where(and(eq(products.id, productId), eq(products.companyId, companyId)));
      if (!row) throw notFound("Product");
      await this.insertSkus(tx, row.product, row.categoryCode, row.qualityName, dto.widthsIn);
      this.changed({ productId });
    });
    return this.getProduct(productId);
  }

  async updateSku(id: string, dto: UpdateSkuDto): Promise<SkuItem> {
    const { version, ...patch } = dto;
    return this.uow.run(async (tx) => {
      const row = await updateVersioned(
        tx,
        skus,
        and(eq(skus.id, id), eq(skus.companyId, actor().companyId))!,
        version,
        patch,
        "SKU",
      );
      this.changed({ productId: row.productId });
      return toSkuItem(row);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async insertSkus(
    tx: Tx,
    product: typeof products.$inferSelect,
    categoryCode: string,
    qualityName: string,
    widths: number[],
  ): Promise<void> {
    const unique = [...new Set(widths.map(formatWidth))];
    if (unique.length === 0) return;
    await tx.insert(skus).values(
      unique.map((w) => ({
        companyId: product.companyId,
        productId: product.id,
        code: `${categoryCode}-${qualityName.slice(0, 3).toUpperCase()}-${String(product.gsm).padStart(3, "0")}-${w}`,
        widthIn: w,
        createdBy: actor().userId,
        updatedBy: actor().userId,
      })),
    );
  }

  /** GSM, roll length and widths must be in the Catalogue settings lists. */
  private async assertAllowed(input: { gsm?: number; lengthM?: number; widths?: number[] }) {
    const issues: { path: string; message: string }[] = [];
    if (input.gsm !== undefined) {
      const list = await this.settings.value("catalogue.gsmList");
      if (!list.includes(input.gsm)) {
        issues.push({ path: "gsm", message: `GSM must be one of ${list.join(", ")} (Settings)` });
      }
    }
    if (input.lengthM !== undefined) {
      const list = await this.settings.value("catalogue.allowedLengthsM");
      if (!list.includes(input.lengthM)) {
        issues.push({
          path: "defaultLengthM",
          message: `Length must be one of ${list.join(", ")} m (Settings)`,
        });
      }
    }
    if (input.widths?.length) {
      const list = await this.settings.value("catalogue.allowedWidthsIn");
      const bad = input.widths.filter((w) => !list.includes(w));
      if (bad.length) {
        issues.push({
          path: "widthsIn",
          message: `${bad.join(", ")}″ not allowed — widths must be one of ${list.join(", ")}″ (Settings)`,
        });
      }
    }
    if (issues.length) throw validationError("Some values aren't in the catalogue settings.", issues);
  }

  private async loadProducts(db: UnitOfWork["db"], where: ReturnType<typeof and>) {
    const rows = await db
      .select({
        product: products,
        categoryName: categories.name,
        qualityName: qualities.name,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(qualities, eq(qualities.id, products.qualityId))
      .where(where)
      .orderBy(asc(categories.name), asc(qualities.name), asc(products.gsm));
    if (rows.length === 0) return [];
    const skuRows = await db
      .select()
      .from(skus)
      .where(
        inArray(
          skus.productId,
          rows.map((r) => r.product.id),
        ),
      )
      .orderBy(asc(skus.widthIn));
    const byProduct = new Map<string, SkuItem[]>();
    for (const s of skuRows) {
      const list = byProduct.get(s.productId) ?? [];
      list.push(toSkuItem(s));
      byProduct.set(s.productId, list);
    }
    return rows.map(
      (r): ProductItem => ({
        id: r.product.id,
        categoryId: r.product.categoryId,
        categoryName: r.categoryName,
        qualityId: r.product.qualityId,
        qualityName: r.qualityName,
        gsm: r.product.gsm,
        name: productName(r.categoryName, r.qualityName, r.product.gsm),
        defaultLengthM: r.product.defaultLengthM,
        active: r.product.active,
        version: r.product.version,
        skus: byProduct.get(r.product.id) ?? [],
      }),
    );
  }

  private ownCategory(id: string) {
    return and(eq(categories.id, id), eq(categories.companyId, actor().companyId))!;
  }

  private changed(data: Record<string, string>) {
    this.bus.publishAfterCommit("catalogue.changed", data);
  }
}

function toCategoryItem(
  c: typeof categories.$inferSelect,
  productCount: number,
  skuCount: number,
): CategoryItem {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    hsnCode: c.hsnCode,
    gstRate: trimDecimal(c.gstRate),
    taxReady: c.hsnCode !== null && c.gstRate !== null,
    active: c.active,
    version: c.version,
    productCount,
    skuCount,
  };
}

function toQualityItem(q: typeof qualities.$inferSelect) {
  return { id: q.id, name: q.name, aliases: q.aliases, active: q.active, version: q.version };
}

function toSkuItem(s: typeof skus.$inferSelect): SkuItem {
  return {
    id: s.id,
    productId: s.productId,
    code: s.code,
    widthIn: formatWidth(s.widthIn),
    taxRateOverride: trimDecimal(s.taxRateOverride),
    active: s.active,
    version: s.version,
  };
}
