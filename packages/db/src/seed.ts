import {
  DOC_TYPE_CODES,
  PERMISSIONS,
  SETTINGS,
  SETTING_KEYS,
  SYSTEM_ROLES,
  defaultSeries,
  expandGrants,
} from "@erp/contracts";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "./client.js";
import {
  account,
  branches,
  companies,
  documentSeries,
  permissions,
  rolePermissions,
  roles,
  settings,
  user,
  userRoles,
} from "./schema/index.js";

export interface SeedOptions {
  owner: { email: string; name: string; password: string };
}

export interface SeedResult {
  companyId: string;
  branchId: string;
  ownerUserId: string;
}

/**
 * Idempotent base data: company placeholder (Q1 pending), Surat branch, permission catalogue,
 * system roles, default settings, document series (ADR-0003) and the Owner account.
 * Re-running never overwrites values someone has changed.
 */
export async function seed(db: Db, options: SeedOptions): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.reason', 'Initial seed', true)`);

    await tx
      .insert(companies)
      .values({
        code: "MAIN",
        legalName: "Company Legal Name (placeholder)",
        tradeName: "Company Trade Name",
        stateCode: "24",
        address: {
          line1: "Address line 1 (placeholder)",
          city: "Surat",
          state: "Gujarat",
          pincode: "395001",
        },
        isPlaceholder: true,
      })
      .onConflictDoNothing({ target: companies.code });
    const company = (await tx.select().from(companies).where(eq(companies.code, "MAIN")))[0]!;

    await tx
      .insert(branches)
      .values({
        companyId: company.id,
        code: "SRT",
        name: "Surat Hub",
        stateCode: "24",
        isDefault: true,
      })
      .onConflictDoNothing();
    const branch = (
      await tx
        .select()
        .from(branches)
        .where(and(eq(branches.companyId, company.id), eq(branches.code, "SRT")))
    )[0]!;

    for (const [code, description] of Object.entries(PERMISSIONS)) {
      await tx
        .insert(permissions)
        .values({ code, module: code.split(".")[0]!, description })
        .onConflictDoUpdate({ target: permissions.code, set: { description } });
    }

    const roleIds = new Map<string, string>();
    for (const role of SYSTEM_ROLES) {
      await tx
        .insert(roles)
        .values({ companyId: company.id, code: role.code, name: role.name, isSystem: true })
        .onConflictDoNothing();
      const row = (
        await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(eq(roles.companyId, company.id), eq(roles.code, role.code)))
      )[0]!;
      roleIds.set(role.code, row.id);
      for (const permissionCode of expandGrants(role.grants)) {
        await tx
          .insert(rolePermissions)
          .values({ roleId: row.id, permissionCode })
          .onConflictDoNothing();
      }
    }

    for (const key of SETTING_KEYS) {
      await tx
        .insert(settings)
        .values({ companyId: company.id, key, value: SETTINGS[key].default })
        .onConflictDoNothing();
    }

    for (const type of DOC_TYPE_CODES) {
      await tx
        .insert(documentSeries)
        .values({ companyId: company.id, ...defaultSeries(type) })
        .onConflictDoNothing();
    }

    const email = options.owner.email.toLowerCase();
    let owner = (await tx.select({ id: user.id }).from(user).where(eq(user.email, email)))[0];
    if (!owner) {
      const userId = uuidv7();
      await tx.insert(user).values({
        id: userId,
        name: options.owner.name,
        email,
        emailVerified: true,
        companyId: company.id,
      });
      await tx.insert(account).values({
        id: uuidv7(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(options.owner.password),
      });
      await tx.insert(userRoles).values({ userId, roleId: roleIds.get("owner")! });
      owner = { id: userId };
    }

    return { companyId: company.id, branchId: branch.id, ownerUserId: owner.id };
  });
}
