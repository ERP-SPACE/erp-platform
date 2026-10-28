import {
  agingQuery,
  agingReport,
  allocationSuggestQuery,
  allocationSuggestion,
  applyCredit,
  blockedOrderItem,
  commissionEntryItem,
  commissionQuery,
  commissionSummary,
  moneyListQuery,
  openItemsResponse,
  partyStatement,
  payoutAction,
  payoutCreate,
  payoutDetail,
  payoutListItem,
  payoutPay,
  receiptAction,
  receiptCreate,
  receiptDetail,
  receiptListItem,
  receiptReverse,
  receiptUpdate,
  statementQuery,
} from "@erp/contracts";
import { zodDto } from "../../common/dto.js";

export class ReceiptCreateDto extends zodDto("ReceiptCreateDto", receiptCreate) {}
export class ReceiptUpdateDto extends zodDto("ReceiptUpdateDto", receiptUpdate) {}
export class ReceiptActionDto extends zodDto("ReceiptActionDto", receiptAction) {}
export class ReceiptReverseDto extends zodDto("ReceiptReverseDto", receiptReverse) {}
export class ReceiptListItemDto extends zodDto("ReceiptListItemDto", receiptListItem) {}
export class ReceiptDetailDto extends zodDto("ReceiptDetailDto", receiptDetail) {}
export class MoneyListQueryDto extends zodDto("MoneyListQueryDto", moneyListQuery) {}
export class OpenItemsDto extends zodDto("OpenItemsDto", openItemsResponse) {}
export class AllocationSuggestQueryDto extends zodDto(
  "AllocationSuggestQueryDto",
  allocationSuggestQuery,
) {}
export class AllocationSuggestionDto extends zodDto(
  "AllocationSuggestionDto",
  allocationSuggestion,
) {}
export class ApplyCreditDto extends zodDto("ApplyCreditDto", applyCredit) {}
export class StatementQueryDto extends zodDto("StatementQueryDto", statementQuery) {}
export class PartyStatementDto extends zodDto("PartyStatementDto", partyStatement) {}
export class AgingQueryDto extends zodDto("AgingQueryDto", agingQuery) {}
export class AgingReportDto extends zodDto("AgingReportDto", agingReport) {}
export class BlockedOrderItemDto extends zodDto("BlockedOrderItemDto", blockedOrderItem) {}
export class CommissionQueryDto extends zodDto("CommissionQueryDto", commissionQuery) {}
export class CommissionEntryItemDto extends zodDto("CommissionEntryItemDto", commissionEntryItem) {}
export class CommissionSummaryDto extends zodDto("CommissionSummaryDto", commissionSummary) {}
export class PayoutCreateDto extends zodDto("PayoutCreateDto", payoutCreate) {}
export class PayoutPayDto extends zodDto("PayoutPayDto", payoutPay) {}
export class PayoutActionDto extends zodDto("PayoutActionDto", payoutAction) {}
export class PayoutListItemDto extends zodDto("PayoutListItemDto", payoutListItem) {}
export class PayoutDetailDto extends zodDto("PayoutDetailDto", payoutDetail) {}
