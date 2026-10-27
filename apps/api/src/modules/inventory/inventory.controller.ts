import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import { RequireFreshAuth, RequirePermission, RequireReason } from "../../auth/decorators.js";
import {
  LabelRequestDto,
  MapRollsDto,
  MapRollsResultDto,
  RollInspectorDto,
  RollItemDto,
  RollLengthCorrectionDto,
  RollListQueryDto,
  RollPageDto,
  ScrapRollsDto,
  ScrapRollsResultDto,
  StockGroupByDto,
  StockSummaryDto,
} from "./inventory.dto.js";
import { LabelsService } from "./labels.service.js";
import { RollsService } from "./rolls.service.js";
import { StockService } from "./stock.service.js";

@ApiTags("inventory")
@Controller()
export class InventoryController {
  constructor(
    private readonly rolls: RollsService,
    private readonly labels: LabelsService,
    private readonly stock: StockService,
  ) {}

  @RequirePermission("inventory.view")
  @ApiOkResponse({ type: RollPageDto })
  @Get("rolls")
  list(@Query() query: RollListQueryDto) {
    return this.rolls.list(query);
  }

  /** Accepts a roll id or a scanned barcode (Roll Inspector, /floor). */
  @RequirePermission("inventory.view")
  @ApiOkResponse({ type: RollInspectorDto })
  @Get("rolls/:idOrBarcode")
  inspect(@Param("idOrBarcode") idOrBarcode: string) {
    return this.rolls.inspect(idOrBarcode);
  }

  @RequirePermission("inventory.map")
  @HttpCode(200)
  @ApiOkResponse({ type: MapRollsResultDto })
  @Post("rolls/map")
  map(@Body() dto: MapRollsDto) {
    return this.rolls.map(dto);
  }

  @RequirePermission("inventory.adjust")
  @RequireFreshAuth()
  @RequireReason()
  @HttpCode(200)
  @ApiOkResponse({ type: ScrapRollsResultDto })
  @Post("rolls/scrap")
  scrap(@Body() dto: ScrapRollsDto) {
    return this.rolls.scrap(dto.rollIds);
  }

  @RequirePermission("inventory.adjust")
  @RequireFreshAuth()
  @RequireReason()
  @ApiOkResponse({ type: RollItemDto })
  @Patch("rolls/:id/length")
  correctLength(@Param("id") id: string, @Body() dto: RollLengthCorrectionDto) {
    return this.rolls.correctLength(id, dto.currentLengthM, dto.version);
  }

  /** PDF or ZPL per Settings → Labels. Send without an Idempotency-Key (the response is a file). */
  @RequirePermission("labels.print")
  @HttpCode(200)
  @ApiProduces("application/pdf", "text/plain")
  @Post("labels")
  async printLabels(@Body() dto: LabelRequestDto) {
    const file = await this.labels.render(dto);
    return new StreamableFile(file.body, {
      type: file.contentType,
      length: file.body.length,
      disposition: `inline; filename="${file.fileName}"`,
    });
  }

  @RequirePermission("inventory.view")
  @ApiOkResponse({ type: StockSummaryDto })
  @Get("inventory/stock")
  stockSummary(@Query() query: StockGroupByDto) {
    return this.stock.summary(query.by);
  }

  @RequirePermission("inventory.view")
  @HttpCode(204)
  @Post("inventory/stock/refresh")
  refresh() {
    return this.stock.refresh();
  }
}
