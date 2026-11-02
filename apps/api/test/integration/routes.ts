import type { PermissionCode } from "@erp/contracts";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { ModulesContainer } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  ALLOW_WITHOUT_TOTP_KEY,
  FRESH_AUTH_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
} from "../../src/auth/decorators.js";

export interface RouteInfo {
  method: string;
  path: string;
  permissions: PermissionCode[];
  public: boolean;
  fresh: boolean;
  withoutTotp: boolean;
  controller: string;
}

/** Every controller route of the running app, with its auth metadata (for the hardening tests). */
export function listRoutes(app: NestFastifyApplication): RouteInfo[] {
  const out: RouteInfo[] = [];
  const meta = <T>(key: string, handler: object, cls: object) =>
    (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, cls)) as T | undefined;
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!cls) continue;
      const base = [Reflect.getMetadata(PATH_METADATA, cls) ?? ""].flat()[0] as string;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        if (name === "constructor") continue;
        const handler = cls.prototype[name as keyof object] as object;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        if (sub === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]!;
        const path =
          `/api/${[base, [sub].flat()[0]].filter((p) => p && p !== "/").join("/")}`.replace(
            /\/+/g,
            "/",
          );
        out.push({
          method,
          path,
          permissions: meta<PermissionCode[]>(PERMISSIONS_KEY, handler, cls) ?? [],
          public: Boolean(meta<boolean>(PUBLIC_KEY, handler, cls)),
          fresh: Boolean(meta<boolean>(FRESH_AUTH_KEY, handler, cls)),
          withoutTotp: Boolean(meta<boolean>(ALLOW_WITHOUT_TOTP_KEY, handler, cls)),
          controller: cls.name,
        });
      }
    }
  }
  return out;
}

/** A concrete URL for a route pattern (ids that exist nowhere). */
export const concrete = (path: string) =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) =>
    /kind|party|chapter|docType|key|type|id$/i.test(name) && !/Id$/.test(name) && name !== "id"
      ? "x"
      : "01a1aaaa-0000-7000-8000-000000000000",
  );
