import { PERMISSION_CODES, type PermissionCode } from "@erp/contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const permissionCode = z.enum(PERMISSION_CODES as [PermissionCode, ...PermissionCode[]]);

export class StepUpDto extends createZodDto(
  z.object({
    password: z.string().min(1).max(128),
    /** Required when the user has two-factor authentication enabled. */
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  }),
) {}

export class CreateUserDto extends createZodDto(
  z.object({
    name: z.string().trim().min(2).max(80),
    email: z.email().toLowerCase(),
    password: z.string().min(10).max(128),
    roleCodes: z.array(z.string()).min(1),
  }),
) {}

export class UpdateUserDto extends createZodDto(
  z.object({
    name: z.string().trim().min(2).max(80).optional(),
    active: z.boolean().optional(),
    roleCodes: z.array(z.string()).min(1).optional(),
  }),
) {}

export class UpdateRolePermissionsDto extends createZodDto(
  z.object({
    permissionCodes: z.array(permissionCode),
    version: z.number().int().positive(),
  }),
) {}
