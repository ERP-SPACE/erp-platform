import {
  einvoiceInfo,
  einvoiceQueueItem,
  einvoiceRequestItem,
  ewayBillGenerate,
  ewayBillInput,
  ewayBillResult,
  manualIrn,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class EInvoiceInfoDto extends zodDto("EInvoiceInfoDto", einvoiceInfo) {}
export class EInvoiceQueueItemDto extends zodDto("EInvoiceQueueItemDto", einvoiceQueueItem) {}
export class EInvoiceRequestItemDto extends zodDto("EInvoiceRequestItemDto", einvoiceRequestItem) {}
export class ManualIrnDto extends zodDto("ManualIrnDto", manualIrn) {}
export class EwayBillGenerateDto extends zodDto("EwayBillGenerateDto", ewayBillGenerate) {}
export class EwayBillInputDto extends zodDto("EwayBillInputDto", ewayBillInput) {}
export class EwayBillResultDto extends zodDto("EwayBillResultDto", ewayBillResult) {}
