import {
  allocationPreview,
  creditCheck,
  customerLedger,
  dcCreate,
  dcCut,
  dcCutResult,
  dcDetail,
  dcListItem,
  dcPick,
  dcPost,
  dcUnpick,
  dcUpdate,
  ledgerQuery,
  noteCreate,
  noteDetail,
  noteItem,
  noteUpdate,
  proformaCreate,
  proformaDetail,
  proformaListItem,
  proformaUpdate,
  rateQuery,
  rateQuote,
  returnInspection,
  salesListQuery,
  salesReturnCreate,
  salesReturnDetail,
  salesReturnItem,
  salesReturnUpdate,
  siAction,
  siCreate,
  siDetail,
  siListItem,
  siUpdate,
  soAction,
  soCreate,
  soDetail,
  soListItem,
  soUpdate,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class SalesListQueryDto extends zodDto("SalesListQueryDto", salesListQuery) {}
export class SalesVersionDto extends zodDto("SalesVersionDto", soAction) {}
export class RateQueryDto extends zodDto("RateQueryDto", rateQuery) {}
export class RateQuoteDto extends zodDto("RateQuoteDto", rateQuote) {}
export class CreditCheckDto extends zodDto("CreditCheckDto", creditCheck) {}
export class AllocationPreviewDto extends zodDto("AllocationPreviewDto", allocationPreview) {}

export class SoCreateDto extends zodDto("SoCreateDto", soCreate) {}
export class SoUpdateDto extends zodDto("SoUpdateDto", soUpdate) {}
export class SoListItemDto extends zodDto("SoListItemDto", soListItem) {}
export class SoDetailDto extends zodDto("SoDetailDto", soDetail) {}

export class DcCreateDto extends zodDto("DcCreateDto", dcCreate) {}
export class DcUpdateDto extends zodDto("DcUpdateDto", dcUpdate) {}
export class DcPickDto extends zodDto("DcPickDto", dcPick) {}
export class DcUnpickDto extends zodDto("DcUnpickDto", dcUnpick) {}
export class DcCutDto extends zodDto("DcCutDto", dcCut) {}
export class DcCutResultDto extends zodDto("DcCutResultDto", dcCutResult) {}
export class DcPostDto extends zodDto("DcPostDto", dcPost) {}
export class DcListItemDto extends zodDto("DcListItemDto", dcListItem) {}
export class DcDetailDto extends zodDto("DcDetailDto", dcDetail) {}

export class SiCreateDto extends zodDto("SiCreateDto", siCreate) {}
export class SiUpdateDto extends zodDto("SiUpdateDto", siUpdate) {}
export class SiActionDto extends zodDto("SiActionDto", siAction) {}
export class SiListItemDto extends zodDto("SiListItemDto", siListItem) {}
export class SiDetailDto extends zodDto("SiDetailDto", siDetail) {}

export class ProformaCreateDto extends zodDto("ProformaCreateDto", proformaCreate) {}
export class ProformaUpdateDto extends zodDto("ProformaUpdateDto", proformaUpdate) {}
export class ProformaListItemDto extends zodDto("ProformaListItemDto", proformaListItem) {}
export class ProformaDetailDto extends zodDto("ProformaDetailDto", proformaDetail) {}

export class SalesReturnCreateDto extends zodDto("SalesReturnCreateDto", salesReturnCreate) {}
export class SalesReturnUpdateDto extends zodDto("SalesReturnUpdateDto", salesReturnUpdate) {}
export class ReturnInspectionDto extends zodDto("ReturnInspectionDto", returnInspection) {}
export class SalesReturnItemDto extends zodDto("SalesReturnItemDto", salesReturnItem) {}
export class SalesReturnDetailDto extends zodDto("SalesReturnDetailDto", salesReturnDetail) {}

export class NoteCreateDto extends zodDto("NoteCreateDto", noteCreate) {}
export class NoteUpdateDto extends zodDto("NoteUpdateDto", noteUpdate) {}
export class NoteItemDto extends zodDto("NoteItemDto", noteItem) {}
export class NoteDetailDto extends zodDto("NoteDetailDto", noteDetail) {}

export class LedgerQueryDto extends zodDto("LedgerQueryDto", ledgerQuery) {}
export class CustomerLedgerDto extends zodDto("CustomerLedgerDto", customerLedger) {}
