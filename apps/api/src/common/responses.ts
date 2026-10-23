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
import { zodDto } from "./dto.js";

/** OpenAPI response DTOs built from the shared Zod schemas in @erp/contracts/api. */
export class MeResponseDto extends zodDto("MeResponseDto", meResponse) {}
export class StepUpResponseDto extends zodDto("StepUpResponseDto", stepUpResponse) {}
export class SettingItemDto extends zodDto("SettingItemDto", settingItem) {}
export class SettingSavedDto extends zodDto("SettingSavedDto", settingSaved) {}
export class CompanyResponseDto extends zodDto("CompanyResponseDto", companyResponse) {}
export class SeriesItemDto extends zodDto("SeriesItemDto", seriesItem) {}
export class SeriesPreviewDto extends zodDto("SeriesPreviewDto", seriesPreview) {}
export class AuditPageDto extends zodDto("AuditPageDto", auditPage) {}
export class UserItemDto extends zodDto("UserItemDto", userItem) {}
export class RoleItemDto extends zodDto("RoleItemDto", roleItem) {}
export class PermissionItemDto extends zodDto("PermissionItemDto", permissionItem) {}
export class IdResponseDto extends zodDto("IdResponseDto", idResponse) {}
