import type { PermissionCode } from "@erp/contracts";
import { branches, type DbHandle, rolePermissions, roles, user, userRoles } from "@erp/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Actor } from "../common/context.js";
import { ENV, type Env } from "../config/env.js";
import { DB } from "../db/tokens.js";
import { REDIS } from "../redis/redis.module.js";

export interface SessionInfo {
  id: string;
  userId: string;
  createdAt: Date;
}

/** Builds the request Actor (roles, permissions, company) and tracks step-up freshness. */
@Injectable()
export class ActorService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async load(session: SessionInfo): Promise<Actor | null> {
    const db = this.handle.db;
    const [u] = await db.select().from(user).where(eq(user.id, session.userId));
    if (!u || !u.active || !u.companyId) return null;

    const grants = await db
      .select({ code: roles.code, permission: rolePermissions.permissionCode })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(userRoles.userId, u.id));
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.companyId, u.companyId), eq(branches.isDefault, true)));

    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      companyId: u.companyId,
      branchId: branch?.id ?? null,
      roles: [...new Set(grants.map((g) => g.code))],
      permissions: new Set(
        grants.flatMap((g) => (g.permission ? [g.permission as PermissionCode] : [])),
      ),
      sessionId: session.id,
      sessionCreatedAt: session.createdAt,
      twoFactorEnabled: Boolean(u.twoFactorEnabled),
    };
  }

  /** Owner must enrol TOTP before doing anything else (ADR-0021). */
  needsTotpEnrolment(actor: Actor): boolean {
    return this.env.REQUIRE_OWNER_TOTP && actor.roles.includes("owner") && !actor.twoFactorEnabled;
  }

  /** Fresh = signed in, or re-confirmed via step-up, within STEP_UP_SECONDS. */
  async freshUntil(actor: Actor): Promise<Date | null> {
    const windowMs = this.env.STEP_UP_SECONDS * 1000;
    const fromLogin = actor.sessionCreatedAt.getTime() + windowMs;
    const stepUpAt = await this.redis.get(this.stepUpKey(actor.sessionId));
    const fromStepUp = stepUpAt ? Number(stepUpAt) + windowMs : 0;
    const until = Math.max(fromLogin, fromStepUp);
    return until > Date.now() ? new Date(until) : null;
  }

  async markSteppedUp(actor: Actor): Promise<Date> {
    const now = Date.now();
    await this.redis.set(
      this.stepUpKey(actor.sessionId),
      String(now),
      "EX",
      this.env.STEP_UP_SECONDS,
    );
    return new Date(now + this.env.STEP_UP_SECONDS * 1000);
  }

  private stepUpKey(sessionId: string): string {
    return `erp:stepup:${sessionId}`;
  }
}
