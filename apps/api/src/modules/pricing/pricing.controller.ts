import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import {
  BulkRevisionDto,
  BulkRevisionPreviewDto,
  BulkRevisionResultDto,
  PartyRateItemDto,
  RateHistoryItemDto,
  SetPartyRateDto,
} from "./pricing.dto.js";
import { PricingService } from "./pricing.service.js";

@ApiTags("pricing")
@Controller()
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @RequirePermission("customers.view")
  @ApiOkResponse({ type: PartyRateItemDto, isArray: true })
  @Get("customers/:id/rates")
  rates(@Param("id") id: string) {
    return this.service.listRates(id);
  }

  @RequirePermission("customers.rates.manage")
  @ApiCreatedResponse({ type: PartyRateItemDto, isArray: true })
  @Post("customers/:id/rates")
  setRate(@Param("id") id: string, @Body() dto: SetPartyRateDto) {
    return this.service.setRate(id, dto);
  }

  @RequirePermission("customers.view")
  @ApiOkResponse({ type: RateHistoryItemDto, isArray: true })
  @Get("customers/:id/rate-history")
  history(@Param("id") id: string) {
    return this.service.history(id);
  }

  @RequirePermission("rates.bulk_revise")
  @HttpCode(200)
  @ApiOkResponse({ type: BulkRevisionPreviewDto })
  @Post("pricing/bulk-revision/preview")
  preview(@Body() dto: BulkRevisionDto) {
    return this.service.previewBulk(dto);
  }

  @RequirePermission("rates.bulk_revise")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: BulkRevisionResultDto })
  @Post("pricing/bulk-revision")
  apply(@Body() dto: BulkRevisionDto) {
    return this.service.applyBulk(dto);
  }
}
