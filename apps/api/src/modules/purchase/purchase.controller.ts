import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import { zodDto } from "../../common/dto.js";
import { GoodsReceiptsService } from "./goods-receipts.service.js";
import { LandedCostService } from "./landed-cost.service.js";
import { PurchaseInvoicesService } from "./purchase-invoices.service.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";
import { PurchaseReturnsService } from "./purchase-returns.service.js";
import {
  GrnCreateDto,
  GrnDetailDto,
  GrnListItemDto,
  GrnPostDto,
  GrnUpdateDto,
  LandedCostChargeItemDto,
  LandedCostPreviewDto,
  LandedCostRequestDto,
  PiCreateDto,
  PiDetailDto,
  PiListItemDto,
  PiPostDto,
  PiUpdateDto,
  PoCreateDto,
  PoDetailDto,
  PoListItemDto,
  PoUpdateDto,
  PurchaseListQueryDto,
  PurchaseReturnCreateDto,
  PurchaseReturnDetailDto,
  PurchaseReturnItemDto,
  PurchaseReturnPostDto,
  PurchaseReturnUpdateDto,
  VersionDto,
} from "./purchase.dto.js";

class LinkGrnsDto extends zodDto("LinkGrnsDto", z.object({ grnIds: z.array(z.string()).min(1) })) {}

@ApiTags("purchase")
@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PoListItemDto, isArray: true })
  @Get()
  list(@Query() query: PurchaseListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PoDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("purchase.order.manage")
  @ApiCreatedResponse({ type: PoDetailDto })
  @Post()
  create(@Body() dto: PoCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("purchase.order.manage")
  @ApiOkResponse({ type: PoDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: PoUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("purchase.order.approve")
  @HttpCode(200)
  @ApiOkResponse({ type: PoDetailDto })
  @Post(":id/approve")
  approve(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.transition(id, "Approved", dto.version);
  }

  @RequirePermission("purchase.order.approve")
  @HttpCode(200)
  @ApiOkResponse({ type: PoDetailDto })
  @Post(":id/close")
  close(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.transition(id, "Closed", dto.version);
  }

  @RequirePermission("purchase.order.approve")
  @HttpCode(200)
  @ApiOkResponse({ type: PoDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.transition(id, "Cancelled", dto.version);
  }
}

@ApiTags("purchase")
@Controller("goods-receipts")
export class GoodsReceiptsController {
  constructor(private readonly service: GoodsReceiptsService) {}

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: GrnListItemDto, isArray: true })
  @Get()
  list(@Query() query: PurchaseListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: GrnDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("purchase.receipt.manage")
  @ApiCreatedResponse({ type: GrnDetailDto })
  @Post()
  create(@Body() dto: GrnCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("purchase.receipt.manage")
  @ApiOkResponse({ type: GrnDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: GrnUpdateDto) {
    return this.service.update(id, dto);
  }

  /** Normal posting; an over-receipt answers 422 APPROVAL_REQUIRED. */
  @RequirePermission("purchase.receipt.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: GrnDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: GrnPostDto) {
    return this.service.post(id, dto.version, false);
  }

  /** Posting that accepts goods beyond the PO: approver, fresh login and a reason (PRD §6.2). */
  @RequirePermission("purchase.receipt.manage", "purchase.over_receipt.approve")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: GrnDetailDto })
  @Post(":id/post-over-receipt")
  postOverReceipt(@Param("id") id: string, @Body() dto: GrnPostDto) {
    return this.service.post(id, dto.version, true);
  }

  @RequirePermission("purchase.receipt.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: GrnDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.cancel(id, dto.version);
  }
}

@ApiTags("purchase")
@Controller()
export class PurchaseInvoicesController {
  constructor(
    private readonly service: PurchaseInvoicesService,
    private readonly landed: LandedCostService,
  ) {}

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PiListItemDto, isArray: true })
  @Get("purchase-invoices")
  list(@Query() query: PurchaseListQueryDto) {
    return this.service.list(query);
  }

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PiDetailDto })
  @Get("purchase-invoices/:id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("purchase.invoice.manage")
  @ApiCreatedResponse({ type: PiDetailDto })
  @Post("purchase-invoices")
  create(@Body() dto: PiCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("purchase.invoice.manage")
  @ApiOkResponse({ type: PiDetailDto })
  @Patch("purchase-invoices/:id")
  update(@Param("id") id: string, @Body() dto: PiUpdateDto) {
    return this.service.update(id, dto);
  }

  /** Lines without a PO line need X-Change-Reason (checked in the service). */
  @RequirePermission("purchase.invoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PiDetailDto })
  @Post("purchase-invoices/:id/post")
  post(@Param("id") id: string, @Body() dto: PiPostDto) {
    return this.service.post(id, dto.version);
  }

  @RequirePermission("purchase.invoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PiDetailDto })
  @Post("purchase-invoices/:id/link-grns")
  linkGrns(@Param("id") id: string, @Body() dto: LinkGrnsDto) {
    return this.service.linkGrns(id, dto.grnIds);
  }

  @RequirePermission("purchase.invoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PiDetailDto })
  @Post("purchase-invoices/:id/cancel")
  cancel(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.cancel(id, dto.version);
  }

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: LandedCostChargeItemDto, isArray: true })
  @Get("purchase-invoices/:id/landed-cost")
  charges(@Param("id") id: string) {
    return this.landed.list(id);
  }

  @RequirePermission("purchase.landed_cost.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: LandedCostPreviewDto })
  @Post("purchase-invoices/:id/landed-cost/preview")
  preview(@Param("id") id: string, @Body() dto: LandedCostRequestDto) {
    return this.landed.preview(id, dto);
  }

  @RequirePermission("purchase.landed_cost.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: LandedCostPreviewDto })
  @Post("purchase-invoices/:id/landed-cost")
  apply(@Param("id") id: string, @Body() dto: LandedCostRequestDto) {
    return this.landed.apply(id, dto);
  }

  @RequirePermission("purchase.landed_cost.manage")
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: LandedCostChargeItemDto, isArray: true })
  @Post("landed-cost-charges/:id/reverse")
  reverse(@Param("id") id: string) {
    return this.landed.reverse(id);
  }
}

@ApiTags("purchase")
@Controller("purchase-returns")
export class PurchaseReturnsController {
  constructor(private readonly service: PurchaseReturnsService) {}

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PurchaseReturnItemDto, isArray: true })
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission("purchase.view")
  @ApiOkResponse({ type: PurchaseReturnDetailDto })
  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @RequirePermission("purchase.return.manage")
  @ApiCreatedResponse({ type: PurchaseReturnDetailDto })
  @Post()
  create(@Body() dto: PurchaseReturnCreateDto) {
    return this.service.create(dto);
  }

  @RequirePermission("purchase.return.manage")
  @ApiOkResponse({ type: PurchaseReturnDetailDto })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: PurchaseReturnUpdateDto) {
    return this.service.update(id, dto);
  }

  @RequirePermission("purchase.return.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PurchaseReturnDetailDto })
  @Post(":id/post")
  post(@Param("id") id: string, @Body() dto: PurchaseReturnPostDto) {
    return this.service.post(id, dto.version);
  }

  @RequirePermission("purchase.return.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: PurchaseReturnDetailDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() dto: VersionDto) {
    return this.service.cancel(id, dto.version);
  }
}
