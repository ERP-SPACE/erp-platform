import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import { actor } from "../../common/context.js";
import { forbidden } from "../../common/errors.js";
import { CreditNightlyService } from "../sales/credit-nightly.service.js";
import {
  AgingQueryDto,
  AgingReportDto,
  AllocationSuggestQueryDto,
  AllocationSuggestionDto,
  ApplyCreditDto,
  BlockedOrderItemDto,
  CommissionEntryItemDto,
  CommissionQueryDto,
  CommissionSummaryDto,
  MoneyListQueryDto,
  OpenItemsDto,
  PartyStatementDto,
  PayoutActionDto,
  PayoutCreateDto,
  PayoutDetailDto,
  PayoutListItemDto,
  PayoutPayDto,
  ReceiptActionDto,
  ReceiptCreateDto,
  ReceiptDetailDto,
  ReceiptListItemDto,
  ReceiptReverseDto,
  ReceiptUpdateDto,
  StatementQueryDto,
} from "./collections.dto.js";
import { CommissionService } from "./commission.service.js";
import { ReceiptsService } from "./receipts.service.js";
import { StatementsService } from "./statements.service.js";

/** Customer receipts (RC/…): money in, allocated to invoices (PRD §8). */
@ApiTags("collections")
@Controller("receipts")
export class ReceiptsController {
  constructor(private readonly service: ReceiptsService) {}

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: ReceiptListItemDto, isArray: true })
  @Get()
  list(@Query() query: MoneyListQueryDto) {
    return this.service.list("CUSTOMER", query);
  }

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get("CUSTOMER", id);
  }

  @RequirePermission("collections.receipt.manage")
  @ApiCreatedResponse({ type: ReceiptDetailDto })
  @Post()
  create(@Body() dto: ReceiptCreateDto) {
    return this.service.create("CUSTOMER", dto);
  }

  @RequirePermission("collections.receipt.manage")
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: ReceiptUpdateDto) {
    return this.service.update("CUSTOMER", id, dto);
  }

  @RequirePermission("collections.receipt.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: ReceiptActionDto) {
    return this.service.post("CUSTOMER", id, dto.version);
  }

  @RequirePermission("collections.receipt.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: ReceiptActionDto) {
    return this.service.cancel("CUSTOMER", id, dto.version);
  }

  /** Cheque bounce or mistake (Q23): reason + fresh login. */
  @RequirePermission("collections.receipt.reverse")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/reverse")
  reverse(@Param("id") id: string, @Body() dto: ReceiptReverseDto) {
    return this.service.reverse("CUSTOMER", id, dto);
  }
}

/** Supplier payments (PY/…): money out, allocated to purchase invoices; large ones need the Owner. */
@ApiTags("collections")
@Controller("supplier-payments")
export class SupplierPaymentsController {
  constructor(private readonly service: ReceiptsService) {}

  @RequirePermission("payables.view")
  @ApiOkResponse({ type: ReceiptListItemDto, isArray: true })
  @Get()
  list(@Query() query: MoneyListQueryDto) {
    return this.service.list("SUPPLIER", query);
  }

  @RequirePermission("payables.view")
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get("SUPPLIER", id);
  }

  @RequirePermission("payables.payment.manage")
  @ApiCreatedResponse({ type: ReceiptDetailDto })
  @Post()
  create(@Body() dto: ReceiptCreateDto) {
    return this.service.create("SUPPLIER", dto);
  }

  @RequirePermission("payables.payment.manage")
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: ReceiptUpdateDto) {
    return this.service.update("SUPPLIER", id, dto);
  }

  @RequirePermission("payables.payment.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: ReceiptActionDto) {
    return this.service.post("SUPPLIER", id, dto.version);
  }

  @RequirePermission("payables.payment.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: ReceiptActionDto) {
    return this.service.cancel("SUPPLIER", id, dto.version);
  }

  @RequirePermission("collections.receipt.reverse")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: ReceiptDetailDto })
  @Post(":id/reverse")
  reverse(@Param("id") id: string, @Body() dto: ReceiptReverseDto) {
    return this.service.reverse("SUPPLIER", id, dto);
  }
}

/** Per-party: open invoices, allocation suggestion, applying credits, statements. */
@ApiTags("collections")
@Controller()
export class PartyAccountsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly statements: StatementsService,
  ) {}

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: OpenItemsDto })
  @Get("customers/:id/open-items")
  customerOpenItems(@Param("id") id: string) {
    return this.receipts.openItems("CUSTOMER", id);
  }

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: AllocationSuggestionDto })
  @Get("customers/:id/allocation-suggestion")
  customerSuggestion(@Param("id") id: string, @Query() q: AllocationSuggestQueryDto) {
    return this.receipts.suggest("CUSTOMER", id, q.amount);
  }

  @RequirePermission("collections.receipt.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: OpenItemsDto })
  @Post("customers/:id/apply-credit")
  customerApply(@Param("id") id: string, @Body() dto: ApplyCreditDto) {
    return this.receipts.applyCredit("CUSTOMER", id, dto);
  }

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: PartyStatementDto })
  @Get("customers/:id/statement")
  customerStatement(@Param("id") id: string, @Query() q: StatementQueryDto) {
    return this.statements.statement("CUSTOMER", id, q.from, q.to);
  }

  @RequirePermission("payables.view")
  @ApiOkResponse({ type: OpenItemsDto })
  @Get("suppliers/:id/open-items")
  supplierOpenItems(@Param("id") id: string) {
    return this.receipts.openItems("SUPPLIER", id);
  }

  @RequirePermission("payables.view")
  @ApiOkResponse({ type: AllocationSuggestionDto })
  @Get("suppliers/:id/allocation-suggestion")
  supplierSuggestion(@Param("id") id: string, @Query() q: AllocationSuggestQueryDto) {
    return this.receipts.suggest("SUPPLIER", id, q.amount);
  }

  @RequirePermission("payables.payment.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: OpenItemsDto })
  @Post("suppliers/:id/apply-credit")
  supplierApply(@Param("id") id: string, @Body() dto: ApplyCreditDto) {
    return this.receipts.applyCredit("SUPPLIER", id, dto);
  }

  @RequirePermission("payables.view")
  @ApiOkResponse({ type: PartyStatementDto })
  @Get("suppliers/:id/statement")
  supplierStatement(@Param("id") id: string, @Query() q: StatementQueryDto) {
    return this.statements.statement("SUPPLIER", id, q.from, q.to);
  }
}

/** AR / AP aging and credit control. */
@ApiTags("collections")
@Controller()
export class CreditControlController {
  constructor(
    private readonly statements: StatementsService,
    private readonly nightly: CreditNightlyService,
  ) {}

  /** AR aging needs `collections.view`; AP aging also needs `payables.view`. */
  @RequirePermission("collections.view")
  @ApiOkResponse({ type: AgingReportDto })
  @Get("aging")
  aging(@Query() q: AgingQueryDto) {
    if (q.partyType === "SUPPLIER" && !actor().permissions.has("payables.view")) {
      throw forbidden("see supplier aging");
    }
    return this.statements.aging(q);
  }

  @RequirePermission("collections.view")
  @ApiOkResponse({ type: BlockedOrderItemDto, isArray: true })
  @Get("credit/blocked-orders")
  blocked() {
    return this.statements.blockedOrders();
  }

  /** Runs the nightly credit check now (normally scheduled; useful after a big receipt day). */
  @RequirePermission("customers.credit.manage")
  @HttpCode(200)
  @Post("credit/nightly-check")
  runNightly() {
    return this.nightly.run();
  }
}

/** Salesman commission: entries, totals and payout batches (Q34). */
@ApiTags("collections")
@Controller("commission")
export class CommissionController {
  constructor(private readonly service: CommissionService) {}

  @RequirePermission("commission.view")
  @ApiOkResponse({ type: CommissionEntryItemDto, isArray: true })
  @Get("entries")
  entries(@Query() q: CommissionQueryDto) {
    return this.service.entries(q);
  }

  @RequirePermission("commission.view")
  @ApiOkResponse({ type: CommissionSummaryDto, isArray: true })
  @Get("summary")
  summary() {
    return this.service.summary();
  }

  @RequirePermission("commission.view")
  @ApiOkResponse({ type: PayoutListItemDto, isArray: true })
  @Get("payouts")
  payouts(@Query("salesmanId") salesmanId?: string) {
    return this.service.payouts(salesmanId);
  }

  @RequirePermission("commission.view")
  @ApiOkResponse({ type: PayoutDetailDto })
  @Get("payouts/:id")
  payout(@Param("id") id: string) {
    return this.service.payout(id);
  }

  @RequirePermission("commission.payout.manage")
  @ApiCreatedResponse({ type: PayoutDetailDto })
  @Post("payouts")
  create(@Body() dto: PayoutCreateDto) {
    return this.service.createPayout(dto);
  }

  @RequirePermission("commission.payout.manage")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: PayoutDetailDto })
  @Post("payouts/:id/pay")
  pay(@Param("id") id: string, @Body() dto: PayoutPayDto) {
    return this.service.pay(id, dto);
  }

  @RequirePermission("commission.payout.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PayoutDetailDto })
  @Post("payouts/:id/cancel")
  cancel(@Param("id") id: string, @Body() dto: PayoutActionDto) {
    return this.service.cancelPayout(id, dto.version);
  }
}
