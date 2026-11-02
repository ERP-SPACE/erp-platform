import {
  batchDiscard,
  cashAccount,
  cashAccountInput,
  cashAccountUpdate,
  chapterConfirm,
  chapterNotNeeded,
  goLiveRequest,
  openingCheckReport,
  openingStatus,
  openingUpload,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class OpeningUploadDto extends zodDto("OpeningUploadDto", openingUpload) {}
export class OpeningCheckReportDto extends zodDto("OpeningCheckReportDto", openingCheckReport) {}
export class OpeningStatusDto extends zodDto("OpeningStatusDto", openingStatus) {}
export class BatchDiscardDto extends zodDto("BatchDiscardDto", batchDiscard) {}
export class ChapterConfirmDto extends zodDto("ChapterConfirmDto", chapterConfirm) {}
export class ChapterNotNeededDto extends zodDto("ChapterNotNeededDto", chapterNotNeeded) {}
export class CashAccountInputDto extends zodDto("CashAccountInputDto", cashAccountInput) {}
export class CashAccountUpdateDto extends zodDto("CashAccountUpdateDto", cashAccountUpdate) {}
export class CashAccountDto extends zodDto("CashAccountDto", cashAccount) {}
export class CashConfirmDto extends zodDto(
  "CashConfirmDto",
  z.object({ version: z.number().int().positive() }),
) {}
export class GoLiveRequestDto extends zodDto("GoLiveRequestDto", goLiveRequest) {}
