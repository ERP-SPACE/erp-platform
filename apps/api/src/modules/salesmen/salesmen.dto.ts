import {
  KYC_DOC_TYPES,
  commissionRuleInput,
  commissionRuleItem,
  isoDate,
  kycDocumentItem,
  listQuery,
  salesmanBlockInput,
  salesmanDefaultRatesInput,
  salesmanDetail,
  salesmanInput,
  salesmanItem,
  salesmanUpdate,
} from "@erp/contracts";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";

export class SalesmanItemDto extends zodDto("SalesmanItemDto", salesmanItem) {}
export class SalesmanDetailDto extends zodDto("SalesmanDetailDto", salesmanDetail) {}
export class SalesmanListQueryDto extends zodDto("SalesmanListQueryDto", listQuery) {}
export class CreateSalesmanDto extends zodDto("CreateSalesmanDto", salesmanInput) {}
export class UpdateSalesmanDto extends zodDto("UpdateSalesmanDto", salesmanUpdate) {}
export class SalesmanDefaultRatesDto extends zodDto(
  "SalesmanDefaultRatesDto",
  salesmanDefaultRatesInput,
) {}
export class SalesmanBlockDto extends zodDto("SalesmanBlockDto", salesmanBlockInput) {}
export class CommissionRuleItemDto extends zodDto("CommissionRuleItemDto", commissionRuleItem) {}
export class CreateCommissionRuleDto extends zodDto(
  "CreateCommissionRuleDto",
  commissionRuleInput,
) {}
export class CloseCommissionRuleDto extends zodDto(
  "CloseCommissionRuleDto",
  z.object({ validTo: isoDate }),
) {}
export class KycDocumentItemDto extends zodDto("KycDocumentItemDto", kycDocumentItem) {}

/** Text fields sent before the file in the multipart body. */
export const kycFields = z.object({
  docType: z.enum(KYC_DOC_TYPES),
  notes: z.string().trim().max(300).optional(),
});
