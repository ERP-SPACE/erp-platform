import { PERMISSIONS, PERMISSION_CODES, STEP_UP_PERMISSIONS } from "@erp/contracts";
import { account, companies, rolePermissions, roles, session, user, userRoles } from "@erp/db";
import { Inject, Injectable } from "@nestjs/common";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { fromNodeHeaders } from "better-auth/node";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";
import { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { ActorService } from "../../auth/actor.service.js";
import { AUTH, type Auth } from "../../auth/auth.factory.js";
import { actor } from "../../common/context.js";
import { AppError, notFound, validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { updateVersioned } from "../../db/versioning.js";
import { REDIS } from "../../redis/redis.module.js";
import { EventBus } from "../realtime/event-bus.js";
import type { CreateUserDto, UpdateUserDto } from "./identity.dto.js";

const STEP_UP_MAX_ATTEMPTS = 5;
const STEP_UP_WINDOW_SECONDS = 300;

@Injectable()
export class IdentityService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly actors: ActorService,
    private readonly bus: EventBus,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async me() {
    const a = actor();
    const [company] = await this.uow.db
      .select({
        id: companies.id,
        legalName: companies.legalName,
        tradeName: companies.tradeName,
        isPlaceholder: companies.isPlaceholder,
      })
      .from(companies)
      .where(eq(companies.id, a.companyId));
    const freshUntil = await this.actors.freshUntil(a);
    return {
      user: { id: a.userId, name: a.name, email: a.email, twoFactorEnabled: a.twoFactorEnabled },
      company,
      roles: a.roles,
      permissions: [...a.permissions].sort(),
      totpEnrolmentRequired: this.actors.needsTotpEnrolment(a),
      freshUntil: freshUntil?.toISOString() ?? null,
    };
  }

  /** Re-confirm identity for sensitive actions (ADR-0021). Throttled per user. */
  async stepUp(password: string, code: string | undefined, headers: IncomingHttpHeaders) {
    const a = actor();
    const attemptsKey = `erp:stepup-attempts:${a.userId}`;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, STEP_UP_WINDOW_SECONDS);
    if (attempts > STEP_UP_MAX_ATTEMPTS) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Too many attempts. Wait a few minutes and try again.",
      );
    }

    const [credential] = await this.uow.db
      .select({ hash: account.password })
      .from(account)
      .where(and(eq(account.userId, a.userId), eq(account.providerId, "credential")));
    const passwordOk = credential?.hash
      ? await verifyPassword({ hash: credential.hash, password })
      : false;
    if (!passwordOk)
      throw validationError("Password is incorrect.", [
        { path: "password", message: "Incorrect password" },
      ]);

    if (a.twoFactorEnabled) {
      if (!code)
        throw validationError("Enter the 6-digit code from your authenticator app.", [
          { path: "code", message: "Required" },
        ]);
      try {
        await this.auth.api.verifyTOTP({ body: { code }, headers: fromNodeHeaders(headers) });
      } catch {
        throw validationError("The authenticator code is incorrect.", [
          { path: "code", message: "Incorrect code" },
        ]);
      }
    }

    await this.redis.del(attemptsKey);
    const freshUntil = await this.actors.markSteppedUp(a);
    return { freshUntil: freshUntil.toISOString() };
  }

  async listUsers() {
    const companyId = actor().companyId;
    const users = await this.uow.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        active: user.active,
        twoFactorEnabled: user.twoFactorEnabled,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.companyId, companyId))
      .orderBy(asc(user.name));
    const assignments = await this.uow.db
      .select({ userId: userRoles.userId, code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.companyId, companyId));
    return users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      roleCodes: assignments.filter((r) => r.userId === u.id).map((r) => r.code),
    }));
  }

  async createUser(dto: CreateUserDto) {
    const companyId = actor().companyId;
    return this.uow.run(async (tx) => {
      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, dto.email));
      if (existing)
        throw validationError("A user with this email already exists.", [
          { path: "email", message: "Already in use" },
        ]);
      const roleIds = await this.resolveRoles(tx, companyId, dto.roleCodes);
      const userId = uuidv7();
      await tx
        .insert(user)
        .values({ id: userId, name: dto.name, email: dto.email, emailVerified: true, companyId });
      await tx.insert(account).values({
        id: uuidv7(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: await hashPassword(dto.password),
      });
      await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
      this.bus.publishAfterCommit("users.changed", { userId });
      return { id: userId };
    });
  }

  async updateUser(userId: string, dto: UpdateUserDto) {
    const a = actor();
    if (userId === a.userId && dto.active === false) {
      throw validationError("You cannot deactivate your own account.");
    }
    return this.uow.run(async (tx) => {
      const [target] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, userId), eq(user.companyId, a.companyId)));
      if (!target) throw notFound("User");
      if (dto.name !== undefined || dto.active !== undefined) {
        await tx
          .update(user)
          .set({
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.active !== undefined && { active: dto.active }),
            updatedAt: new Date(),
          })
          .where(eq(user.id, userId));
      }
      if (dto.active === false) await tx.delete(session).where(eq(session.userId, userId)); // sign out everywhere
      if (dto.roleCodes) {
        const roleIds = await this.resolveRoles(tx, a.companyId, dto.roleCodes);
        if (userId === a.userId && !dto.roleCodes.includes("owner") && a.roles.includes("owner")) {
          throw validationError("You cannot remove the Owner role from yourself.");
        }
        await tx.delete(userRoles).where(eq(userRoles.userId, userId));
        await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
      }
      this.bus.publishAfterCommit("users.changed", { userId });
      return { id: userId };
    });
  }

  async listRoles() {
    const companyId = actor().companyId;
    const rows = await this.uow.db
      .select()
      .from(roles)
      .where(eq(roles.companyId, companyId))
      .orderBy(asc(roles.name));
    const grants = await this.uow.db
      .select()
      .from(rolePermissions)
      .where(
        inArray(
          rolePermissions.roleId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      locked: r.code === "owner",
      version: r.version,
      permissionCodes: grants
        .filter((g) => g.roleId === r.id)
        .map((g) => g.permissionCode)
        .sort(),
    }));
  }

  permissionCatalogue() {
    return PERMISSION_CODES.map((code) => ({
      code,
      module: code.split(".")[0],
      description: PERMISSIONS[code],
      stepUp: STEP_UP_PERMISSIONS.includes(code),
    }));
  }

  async updateRolePermissions(roleId: string, permissionCodes: string[], version: number) {
    const companyId = actor().companyId;
    return this.uow.run(async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)));
      if (!role) throw notFound("Role");
      if (role.code === "owner")
        throw validationError("The Owner role always has every permission.");
      await updateVersioned(tx, roles, eq(roles.id, roleId), version, {}, "Role");
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (permissionCodes.length) {
        await tx
          .insert(rolePermissions)
          .values(
            [...new Set(permissionCodes)].map((permissionCode) => ({ roleId, permissionCode })),
          );
      }
      this.bus.publishAfterCommit("users.changed", { roleId });
      return { id: roleId };
    });
  }

  private async resolveRoles(
    tx: Parameters<Parameters<UnitOfWork["run"]>[0]>[0],
    companyId: string,
    codes: string[],
  ) {
    const rows = await tx
      .select({ id: roles.id, code: roles.code })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), inArray(roles.code, codes)));
    const unknown = codes.filter((c) => !rows.some((r) => r.code === c));
    if (unknown.length)
      throw validationError(`Unknown role(s): ${unknown.join(", ")}`, [
        { path: "roleCodes", message: "Unknown role" },
      ]);
    return rows.map((r) => r.id);
  }
}
