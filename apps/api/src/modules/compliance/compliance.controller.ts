import { EINVOICE_DOC_TYPES } from "@erp/contracts";
import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission, RequireReason } from "../../auth/decorators.js";
import {
  EInvoiceInfoDto,
  EInvoiceQueueItemDto,
  EInvoiceRequestItemDto,
  EwayBillGenerateDto,
  EwayBillInputDto,
  EwayBillResultDto,
  ManualIrnDto,
} from "./compliance.dto.js";
import type { EDocType } from "./einvoice-documents.js";
import { EInvoiceService } from "./einvoice.service.js";

const docType = new ParseEnumPipe(Object.fromEntries(EINVOICE_DOC_TYPES.map((t) => [t, t])));

/** E-invoicing (ADR-0011): the IRN queue, retries, manual fallback and e-way bills. */
@ApiTags("compliance")
@Controller("einvoice")
export class ComplianceController {
  constructor(private readonly service: EInvoiceService) {}

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: EInvoiceQueueItemDto, isArray: true })
  @Get("queue")
  queue() {
    return this.service.queue();
  }

  @RequirePermission("sales.view")
  @ApiOkResponse({ type: EInvoiceRequestItemDto, isArray: true })
  @Get(":docType/:id/requests")
  requests(@Param("docType", docType) type: EDocType, @Param("id") id: string) {
    return this.service.requests(type, id);
  }

  /** Report to the IRP now (after fixing what it rejected, or to skip the queue). */
  @RequirePermission("compliance.einvoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: EInvoiceInfoDto })
  @Post(":docType/:id/generate")
  generate(@Param("docType", docType) type: EDocType, @Param("id") id: string) {
    return this.service.retry(type, id);
  }

  /** Record an IRN generated on the portal by hand. */
  @RequirePermission("compliance.einvoice.manage")
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: EInvoiceInfoDto })
  @Post(":docType/:id/manual")
  manual(
    @Param("docType", docType) type: EDocType,
    @Param("id") id: string,
    @Body() dto: ManualIrnDto,
  ) {
    return this.service.recordManual(type, id, dto);
  }

  @RequirePermission("compliance.einvoice.manage")
  @HttpCode(200)
  @ApiOkResponse({ type: EwayBillResultDto })
  @Post("SI/:id/eway-bill")
  ewayBill(@Param("id") id: string, @Body() dto: EwayBillGenerateDto) {
    return this.service.ewayBill(id, dto);
  }

  @RequirePermission("compliance.einvoice.manage")
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: EwayBillResultDto })
  @Post("SI/:id/eway-bill/manual")
  ewayBillManual(@Param("id") id: string, @Body() dto: EwayBillInputDto) {
    return this.service.recordEwayBill(id, dto);
  }
}
