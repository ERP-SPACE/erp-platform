import {
  bulkRevisionInput,
  bulkRevisionPreview,
  bulkRevisionResult,
  partyRateInput,
  partyRateItem,
  rateHistoryItem,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class PartyRateItemDto extends zodDto("PartyRateItemDto", partyRateItem) {}
export class SetPartyRateDto extends zodDto("SetPartyRateDto", partyRateInput) {}
export class RateHistoryItemDto extends zodDto("RateHistoryItemDto", rateHistoryItem) {}
export class BulkRevisionDto extends zodDto("BulkRevisionDto", bulkRevisionInput) {}
export class BulkRevisionPreviewDto extends zodDto("BulkRevisionPreviewDto", bulkRevisionPreview) {}
export class BulkRevisionResultDto extends zodDto("BulkRevisionResultDto", bulkRevisionResult) {}
