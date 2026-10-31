import {
  exportItem,
  exportRequest,
  pivotResponse,
  pivotSpec,
  reportCatalogue,
  reportQuery,
  reportResponse,
  savedPivot,
  savedPivotInput,
  savedPivotUpdate,
  todayResponse,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class ReportQueryDto extends zodDto("ReportQueryDto", reportQuery) {}
export class ReportResponseDto extends zodDto("ReportResponseDto", reportResponse) {}
export class ReportCatalogueDto extends zodDto("ReportCatalogueDto", reportCatalogue) {}
export class PivotSpecDto extends zodDto("PivotSpecDto", pivotSpec) {}
export class PivotResponseDto extends zodDto("PivotResponseDto", pivotResponse) {}
export class SavedPivotDto extends zodDto("SavedPivotDto", savedPivot) {}
export class SavedPivotInputDto extends zodDto("SavedPivotInputDto", savedPivotInput) {}
export class SavedPivotUpdateDto extends zodDto("SavedPivotUpdateDto", savedPivotUpdate) {}
export class TodayResponseDto extends zodDto("TodayResponseDto", todayResponse) {}
export class ExportRequestDto extends zodDto("ExportRequestDto", exportRequest) {}
export class ExportItemDto extends zodDto("ExportItemDto", exportItem) {}
export class RefreshResultDto extends zodDto(
  "RefreshResultDto",
  z.object({ refreshed: z.boolean(), asOf: z.string().nullable() }),
) {}
