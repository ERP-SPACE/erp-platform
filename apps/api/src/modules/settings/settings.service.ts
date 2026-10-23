import { SETTINGS, SETTING_KEYS, isSettingKey } from "@erp/contracts";
import { companies, settings, user } from "@erp/db";
import { GST_STATES, validateGstin } from "@erp/domain";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { actor } from "../../common/context.js";
import { notFound, validationError, versionConflict } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { EventBus } from "../realtime/event-bus.js";
import type { UpdateCompanyDto } from "./settings.dto.js";

@Injectable()
export class SettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly bus: EventBus,
  ) {}

  async list() {
    const companyId = actor().companyId;
    const rows = await this.uow.db
      .select({
        key: settings.key,
        value: settings.value,
        version: settings.version,
        updatedAt: settings.updatedAt,
        updatedByName: user.name,
      })
      .from(settings)
      .leftJoin(user, eq(user.id, settings.updatedBy))
      .where(eq(settings.companyId, companyId));
    const byKey = new Map(rows.map((r) => [r.key, r]));

    // Keys added in later releases appear with their default and version 0 until first saved.
    return SETTING_KEYS.map((key) => {
      const row = byKey.get(key);
      const def = SETTINGS[key];
      return {
        key,
        label: def.label,
        group: def.group,
        value: row?.value ?? def.default,
        defaultValue: def.default,
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
        updatedByName: row?.updatedByName ?? null,
      };
    });
  }

  async update(key: string, value: unknown, version: number) {
    if (!isSettingKey(key)) throw notFound(`Setting "${key}"`);
    let parsed: unknown;
    try {
      parsed = SETTINGS[key].schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw validationError(
          "The value is not valid for this setting.",
          error.issues.map((i) => ({ path: ["value", ...i.path].join("."), message: i.message })),
        );
      }
      throw error;
    }

    const companyId = actor().companyId;
    const saved = await this.uow.run(async (tx) => {
      const where = and(eq(settings.companyId, companyId), eq(settings.key, key))!;
      let row: typeof settings.$inferSelect;
      if (version === 0) {
        const inserted = await tx
          .insert(settings)
          .values({
            companyId,
            key,
            value: parsed,
            createdBy: actor().userId,
            updatedBy: actor().userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted[0]) {
          const [current] = await tx.select().from(settings).where(where);
          throw versionConflict({
            version: current!.version,
            updatedBy: current!.updatedBy,
            updatedAt: current!.updatedAt.toISOString(),
          });
        }
        row = inserted[0];
      } else {
        row = await updateVersioned(
          tx,
          settings,
          where,
          version,
          { value: parsed },
          `Setting "${key}"`,
        );
      }
      this.bus.publishAfterCommit("settings.changed", { key, version: row.version });
      return row;
    });

    return { key, value: saved.value, version: saved.version };
  }

  async getCompany() {
    const [company] = await this.uow.db
      .select()
      .from(companies)
      .where(eq(companies.id, actor().companyId));
    if (!company) throw notFound("Company");
    return company;
  }

  async updateCompany(dto: UpdateCompanyDto) {
    if (!(dto.stateCode in GST_STATES)) {
      throw validationError("Unknown GST state code.", [
        { path: "stateCode", message: "Unknown state code" },
      ]);
    }
    if (dto.gstin) {
      const check = validateGstin(dto.gstin);
      const issues: { path: string; message: string }[] = [];
      if (!check.valid) issues.push({ path: "gstin", message: check.error! });
      else {
        if (check.stateCode !== dto.stateCode) {
          issues.push({ path: "stateCode", message: `GSTIN belongs to state ${check.stateCode}` });
        }
        if (dto.pan && check.pan !== dto.pan) {
          issues.push({ path: "pan", message: "PAN does not match characters 3–12 of the GSTIN" });
        }
      }
      if (issues.length) throw validationError("The GST details don't match.", issues);
    }

    const { version, ...fields } = dto;
    const companyId = actor().companyId;
    return this.uow.run(async (tx) => {
      const saved = await updateVersioned(
        tx,
        companies,
        eq(companies.id, companyId),
        version,
        {
          ...fields,
          pan: fields.pan ?? (fields.gstin ? fields.gstin.slice(2, 12) : null),
          isPlaceholder: false,
        },
        "Company",
      );
      this.bus.publishAfterCommit("settings.changed", { key: "company", version: saved.version });
      return saved;
    });
  }
}
