import { z } from "zod";

/**
 * Response shapes for Stage 0 endpoints. The API declares them for OpenAPI, and the web app
 * gets matching types through the generated client (pnpm api:gen).
 */
export const meResponse = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), twoFactorEnabled: z.boolean() }),
  company: z.object({
    id: z.string(),
    legalName: z.string(),
    tradeName: z.string().nullable(),
    isPlaceholder: z.boolean(),
  }),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  totpEnrolmentRequired: z.boolean(),
  freshUntil: z.string().nullable(),
});

export const stepUpResponse = z.object({ freshUntil: z.string() });

export const settingItem = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  value: z.unknown(),
  defaultValue: z.unknown(),
  version: z.number().int(),
  updatedAt: z.string().nullable(),
  updatedByName: z.string().nullable(),
});

export const settingSaved = z.object({ key: z.string(), value: z.unknown(), version: z.number().int() });

const address = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

export const companyResponse = z.object({
  id: z.string(),
  code: z.string(),
  legalName: z.string(),
  tradeName: z.string().nullable(),
  gstin: z.string().nullable(),
  stateCode: z.string(),
  pan: z.string().nullable(),
  address,
  bank: z
    .object({
      bankName: z.string(),
      accountName: z.string(),
      accountNumber: z.string(),
      ifsc: z.string(),
      branch: z.string().optional(),
    })
    .nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  logoKey: z.string().nullable(),
  signatoryName: z.string().nullable(),
  isPlaceholder: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});

export const seriesItem = z.object({
  entityType: z.string(),
  label: z.string(),
  gst: z.boolean(),
  prefixTemplate: z.string(),
  padding: z.number().int(),
  resetOnFy: z.boolean(),
  numberedOn: z.enum(["create", "post"]),
  version: z.number().int(),
  usedThisYear: z.number().int(),
  nextNumber: z.string(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
});

export const seriesPreview = z.object({ entityType: z.string(), date: z.string(), nextNumber: z.string() });

export const auditItem = z.object({
  id: z.number().int(),
  at: z.string(),
  tableName: z.string(),
  rowId: z.string().nullable(),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  changedKeys: z.array(z.string()).nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
});

export const auditPage = z.object({ items: z.array(auditItem), nextCursor: z.string().nullable() });

export const userItem = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  twoFactorEnabled: z.boolean().nullable(),
  createdAt: z.string(),
  roleCodes: z.array(z.string()),
});

export const roleItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  locked: z.boolean(),
  version: z.number().int(),
  permissionCodes: z.array(z.string()),
});

export const permissionItem = z.object({
  code: z.string(),
  module: z.string(),
  description: z.string(),
  stepUp: z.boolean(),
});

export const idResponse = z.object({ id: z.string() });

export type MeResponse = z.infer<typeof meResponse>;
export type SettingItem = z.infer<typeof settingItem>;
export type CompanyResponse = z.infer<typeof companyResponse>;
export type SeriesItem = z.infer<typeof seriesItem>;
export type AuditItem = z.infer<typeof auditItem>;
export type AuditPage = z.infer<typeof auditPage>;
export type UserItem = z.infer<typeof userItem>;
export type RoleItem = z.infer<typeof roleItem>;
export type PermissionItem = z.infer<typeof permissionItem>;
