import type { PermissionCode } from "@erp/contracts";
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { requestContext } from "../common/context.js";
import {
  forbidden,
  reasonRequired,
  stepUpRequired,
  totpEnrolmentRequired,
  unauthenticated,
} from "../common/errors.js";
import { ActorService } from "./actor.service.js";
import { AUTH, type Auth } from "./auth.factory.js";
import {
  ALLOW_WITHOUT_TOTP_KEY,
  FRESH_AUTH_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  REQUIRE_REASON_KEY,
} from "./decorators.js";

/**
 * Global guard: session → Actor, then TOTP enrolment, permissions, step-up and reason checks.
 * Order matters: a missing session is 401 before anything else is evaluated.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly actors: ActorService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);
    if (meta<boolean>(PUBLIC_KEY)) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(request.raw.headers) });
    if (!result) throw unauthenticated();

    const actor = await this.actors.load({
      id: result.session.id,
      userId: result.user.id,
      createdAt: new Date(result.session.createdAt),
    });
    if (!actor) throw unauthenticated();
    const store = requestContext.getStore();
    if (store) store.actor = actor;

    if (!meta<boolean>(ALLOW_WITHOUT_TOTP_KEY) && this.actors.needsTotpEnrolment(actor)) {
      throw totpEnrolmentRequired();
    }

    const required = meta<PermissionCode[]>(PERMISSIONS_KEY) ?? [];
    const missing = required.filter((code) => !actor.permissions.has(code));
    if (missing.length > 0) throw forbidden(`perform this action (needs ${missing.join(", ")})`);

    if (meta<boolean>(FRESH_AUTH_KEY) && !(await this.actors.freshUntil(actor))) throw stepUpRequired();
    if (meta<boolean>(REQUIRE_REASON_KEY) && !store?.reason) throw reasonRequired();
    return true;
  }
}
