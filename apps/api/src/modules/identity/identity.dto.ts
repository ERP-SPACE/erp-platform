import { PERMISSION_CODES, type PermissionCode } from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

const permissionCode = z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]]);

export class StepUpDto extends zodDto(
  "StepUpDto",
  z.object({
    password: z.string().min(1).max(128),
    /** Required when the user has two-factor authentication enabled. */
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  }),
) {}

export class CreateUserDto extends zodDto(
  "CreateUserDto",
  z.object({
    name: z.string().trim().min(2).max(80),
    email: z.email().toLowerCase(),
    password: z.string().min(10).max(128),
    roleCodes: z.array(z.string()).min(1),
  }),
) {}

export class UpdateUserDto extends zodDto(
  "UpdateUserDto",
  z.object({
    name: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
    roleCodes: z.array(z.string()).min(1).optional(),
  }),
) {}

export class UpdateRolePermissionsDto extends zodDto(
  "UpdateRolePermissionsDto",
  z.object({
    permissionCodes: z.array(permissionCode),
    version: z.number().int().positive(),
  }),
) {}
