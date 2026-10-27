import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import { validationError } from "../../common/errors.js";
import { UnitOfWork } from "../../db/unit-of-work.js";
import { ChallansService } from "./challans.service.js";
import { CreditService } from "./credit.service.js";
import { LedgerService } from "./ledger.service.js";
import { NotesService } from "./notes.service.js";
import { ProformasService } from "./proformas.service.js";
import { customerContext } from "./sales-common.js";
import { SalesInvoicesService } from "./sales-invoices.service.js";
import { SalesOrdersService } from "./sales-orders.service.js";
import { SalesReturnsService } from "./sales-returns.service.js";
import {
  AllocationPreviewDto,
  CreditCheckDto,
  CustomerLedgerDto,
  DcCreateDto,
  DcCutDto,
  DcCutResultDto,
  DcDetailDto,
  DcListItemDto,
  DcPickDto,
  DcPostDto,
  DcUnpickDto,
  DcUpdateDto,
  LedgerQueryDto,
  NoteCreateDto,
  NoteDetailDto,
  NoteItemDto,
  NoteUpdateDto,
  ProformaCreateDto,
  ProformaDetailDto,
  ProformaListItemDto,
  ProformaUpdateDto,
  RateQueryDto,
  RateQuoteDto,
  ReturnInspectionDto,
  SalesListQueryDto,
  SalesReturnCreateDto,
  SalesReturnDetailDto,
  SalesReturnItemDto,
  SalesReturnUpdateDto,
  SalesVersionDto,
  SiActionDto,
  SiCreateDto,
  SiDetailDto,
  SiListItemDto,
  SiUpdateDto,
  SoCreateDto,
  SoDetailDto,
  SoListItemDto,
  SoUpdateDto,
} from "./sales.dto.js";

@ApiTags("sales")
@Controller("sales-orders")
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: RateQuoteDto })
  @Get("rate-quote")
  quote(@Query() q: RateQueryDto) {
    return this.service.quote(q.customerId, q.skuId, q.date);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SoListItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SoDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: AllocationPreviewDto })
  @Get(":id/allocation")
  allocation(@Param("id") id: string) {
    return this.service.allocation(id);
  }

  @RequirePermission("sales.order.manage")
  @ApiCreatedResponse({ type: SoDetailDto })
  @Post()
  create(@Body() dto: SoCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("sales.order.manage")
  @ApiOkResponse({ type: SoDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: SoUpdateDto) {
    return this.service.update(id, dto);
  }

  /** Runs the credit check: the order comes back Confirmed or OnHold (both are 200). */
  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/confirm")
  confirm(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.confirm(id, dto.version);
  }

  @RequirePermission("pricing.override.approve")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/approve-rates")
  approveRates(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.approveRates(id, dto.version);
  }

  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/recheck")
  recheck(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.recheck(id, dto.version);
  }

  @RequirePermission("sales.credit.release")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/release")
  release(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.release(id, dto.version);
  }

  @RequirePermission("sales.credit.release")
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/hold")
  hold(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.transition(id, "OnHold", dto.version);
  }

  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/close")
  close(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.transition(id, "Closed", dto.version);
  }

  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SoDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.transition(id, "Cancelled", dto.version);
  }
}

@ApiTags("sales")
@Controller("delivery-challans")
export class ChallansController {
  constructor(private readonly service: ChallansService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: DcListItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: DcDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.dispatch.manage")
  @ApiCreatedResponse({ type: DcDetailDto })
  @Post()
  create(@Body() dto: DcCreateDto) {
    return this.service.create(dto.soId, dto.date);
  }

  @RequirePermission("sales.dispatch.manage")
  @ApiOkResponse({ type: DcDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: DcUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("sales.dispatch.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: DcDetailDto })
  @Post(":id/pick")
  pick(@Param("id") id: string, @Body() dto: DcPickDto) {
    return this.service.pick(id, dto);
  }

  @RequirePermission("sales.dispatch.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: DcDetailDto })
  @Post(":id/unpick")
  unpick(@Param("id") id: string, @Body() dto: DcUnpickDto) {
    return this.service.unpick(id, dto.rollId);
  }

  @RequirePermission("sales.dispatch.manage", "inventory.roll.cut")
  @HttpCode(200)
  @ApiOkResponse({ type: DcCutResultDto })
  @Post(":id/cut")
  cut(@Param("id") id: string, @Body() dto: DcCutDto) {
    return this.service.cut(id, dto);
  }

  @RequirePermission("sales.dispatch.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: DcDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: DcPostDto) {
    return this.service.post(id, dto.version);
  }

  @RequirePermission("sales.dispatch.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: DcDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: DcPostDto) {
    return this.service.cancel(id, dto.version);
  }
}

@ApiTags("sales")
@Controller("sales-invoices")
export class SalesInvoicesController {
  constructor(
    private readonly service: SalesInvoicesService,
    private readonly uow: UnitOfWork,
  ) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SiListItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SiDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.invoice.manage")
  @ApiCreatedResponse({ type: SiDetailDto })
  @Post()
  create(@Body() dto: SiCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("sales.invoice.manage")
  @ApiOkResponse({ type: SiDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: SiUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("sales.invoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SiDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: SiActionDto) {
    return this.service.post(id, dto.version);
  }

  /** Throws away a draft (held rolls go back to stock). */
  @RequirePermission("sales.invoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SiDetailDto })
  @Post(":id/discard")
  async discard(@Param("id") id: string, @Body() dto: SiActionDto) {
    const si = await this.service.get(id);
    if (si.status !== "Draft")
      throw validationError("Only a draft can be discarded. Cancel a posted invoice instead.");
    return this.service.cancel(id, dto.version);
  }

  /** Cancels a posted invoice within the IRN window (ADR-0011). */
  @RequirePermission("sales.invoice.cancel")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: SiDetailDto })
  @Post(":id/cancel")
  async cancel(@Param("id") id: string, @Body() dto: SiActionDto) {
    const si = await this.service.get(id);
    if (si.status !== "Posted")
      throw validationError("Only a posted invoice can be cancelled; discard a draft.");
    return this.service.cancel(id, dto.version);
  }
}

@ApiTags("sales")
@Controller("proformas")
export class ProformasController {
  constructor(private readonly service: ProformasService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: ProformaListItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: ProformaDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.order.manage")
  @ApiCreatedResponse({ type: ProformaDetailDto })
  @Post()
  create(@Body() dto: ProformaCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("sales.order.manage")
  @ApiOkResponse({ type: ProformaDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: ProformaUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ProformaDetailDto })
  @Post(":id/send")
  send(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.transition(id, "Sent", dto.version);
  }

  @RequirePermission("sales.order.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: ProformaDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.transition(id, "Cancelled", dto.version);
  }
}

@ApiTags("sales")
@Controller("sales-returns")
export class SalesReturnsController {
  constructor(private readonly service: SalesReturnsService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SalesReturnItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: SalesReturnDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.return.manage")
  @ApiCreatedResponse({ type: SalesReturnDetailDto })
  @Post()
  create(@Body() dto: SalesReturnCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("sales.return.manage")
  @ApiOkResponse({ type: SalesReturnDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: SalesReturnUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("sales.return.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SalesReturnDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.post(id, dto.version);
  }

  @RequirePermission("sales.return.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SalesReturnDetailDto })
  @Post(":id/inspect")
  inspect(@Param("id") id: string, @Body() dto: ReturnInspectionDto) {
    return this.service.inspect(id, dto);
  }

  @RequirePermission("sales.return.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: SalesReturnDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.cancel(id, dto.version);
  }
}

@ApiTags("sales")
@Controller("customer-notes")
export class NotesController {
  constructor(private readonly service: NotesService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: NoteItemDto, isArray: true })
  @Get()
  list(@Query() query: SalesListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: NoteDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("sales.note.manage")
  @ApiCreatedResponse({ type: NoteDetailDto })
  @Post()
  create(@Body() dto: NoteCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("sales.note.manage")
  @ApiOkResponse({ type: NoteDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: NoteUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("sales.note.manage")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: NoteDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.post(id, dto.version);
  }

  @RequirePermission("sales.note.manage")
  @RequireFreshAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: NoteDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: SalesVersionDto) {
    return this.service.cancel(id, dto.version);
  }
}

@ApiTags("sales")
@Controller("customers")
export class CustomerAccountController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly credit: CreditService,
    private readonly uow: UnitOfWork,
  ) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: CustomerLedgerDto })
  @Get(":id/ledger")
  get(@Param("id") id: string, @Query() q: LedgerQueryDto) {
    return this.ledger.ledger(id, q.from, q.to);
  }

  /** Where the customer stands right now, before any new order. */
  @RequirePermission("sales.view")
  @ApiOkResponse({ type: CreditCheckDto })
  @Get(":id/credit-check")
  async creditCheck(@Param("id") id: string) {
    const c = await customerContext(this.uow.db, id);
    return this.credit.forCustomer(id, c.policy);
  }
}
