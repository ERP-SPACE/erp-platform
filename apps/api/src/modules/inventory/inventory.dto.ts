import {
  labelRequest,
  mapRollsInput,
  mapRollsResult,
  rollInspector,
  rollLengthCorrection,
  rollListQuery,
  rollPage,
  rollItem,
  scrapRollsInput,
  scrapRollsResult,
  stockGroupBy,
  stockSummary,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class RollListQueryDto extends zodDto("RollListQueryDto", rollListQuery) {}
export class RollPageDto extends zodDto("RollPageDto", rollPage) {}
export class RollItemDto extends zodDto("RollItemDto", rollItem) {}
export class RollInspectorDto extends zodDto("RollInspectorDto", rollInspector) {}
export class MapRollsDto extends zodDto("MapRollsDto", mapRollsInput) {}
export class MapRollsResultDto extends zodDto("MapRollsResultDto", mapRollsResult) {}
export class ScrapRollsDto extends zodDto("ScrapRollsDto", scrapRollsInput) {}
export class ScrapRollsResultDto extends zodDto("ScrapRollsResultDto", scrapRollsResult) {}
export class RollLengthCorrectionDto extends zodDto(
  "RollLengthCorrectionDto",
  rollLengthCorrection,
) {}
export class LabelRequestDto extends zodDto("LabelRequestDto", labelRequest) {}
export class StockGroupByDto extends zodDto("StockGroupByDto", stockGroupBy) {}
export class StockSummaryDto extends zodDto("StockSummaryDto", stockSummary) {}
