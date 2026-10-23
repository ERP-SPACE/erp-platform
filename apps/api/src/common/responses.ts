import {
  auditPage,
  companyResponse,
  idResponse,
  meResponse,
  permissionItem,
  roleItem,
  seriesItem,
  seriesPreview,
  settingItem,
  settingSaved,
  stepUpResponse,
  userItem,
} from "@erp/contracts";
import { createZodDto } from "nestjs-zod";

/** OpenAPI response DTOs built from the shared Zod schemas in @erp/contracts/api. */
export class MeResponseDto extends createZodDto(meResponse) {}
export class StepUpResponseDto extends createZodDto(stepUpResponse) {}
export class SettingItemDto extends createZodDto(settingItem) {}
export class SettingSavedDto extends createZodDto(settingSaved) {}
export class CompanyResponseDto extends createZodDto(companyResponse) {}
export class SeriesItemDto extends createZodDto(seriesItem) {}
export class SeriesPreviewDto extends createZodDto(seriesPreview) {}
export class AuditPageDto extends createZodDto(auditPage) {}
export class UserItemDto extends createZodDto(userItem) {}
export class RoleItemDto extends createZodDto(roleItem) {}
export class PermissionItemDto extends createZodDto(permissionItem) {}
export class IdResponseDto extends createZodDto(idResponse) {}
