import { REPORT_IDS, type ReportId } from "@erp/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import {
  ExportItemDto,
  ExportRequestDto,
  PivotResponseDto,
  PivotSpecDto,
  ReportCatalogueDto,
  ReportQueryDto,
  RefreshResultDto,
  ReportResponseDto,
  SavedPivotDto,
  SavedPivotInputDto,
  SavedPivotUpdateDto,
  TodayResponseDto,
} from "./reports.dto.js";
import { ExportsService } from "./exports.service.js";
import { ReportsService } from "./reports.service.js";
import { TodayService } from "./today.service.js";

const REPORT_ID = new ParseEnumPipe(Object.fromEntries(REPORT_IDS.map((id) => [id, id])));

/** Today, reports (PRD §9), the pivot builder and exports (Stage 5). */
@ApiTags("reports")
@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly todayService: TodayService,
    private readonly exportsService: ExportsService,
  ) {}

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: TodayResponseDto })
  @Get("today")
  today() {
    return this.todayService.today();
  }

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: ReportCatalogueDto })
  @Get("reports")
  catalogue() {
    return this.reports.catalogue();
  }

  // Fixed paths before `reports/:id`.
  @RequirePermission("reports.view")
  @HttpCode(200)
  @ApiOkResponse({ type: RefreshResultDto })
  @Post("reports/refresh")
  refresh() {
    return this.reports.refreshNow();
  }

  @RequirePermission("reports.view")
  @HttpCode(200)
  @ApiOkResponse({ type: PivotResponseDto })
  @Post("reports/pivot")
  pivot(@Body() spec: PivotSpecDto) {
    return this.reports.pivot(spec);
  }

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: SavedPivotDto, isArray: true })
  @Get("reports/pivots")
  listPivots() {
    return this.reports.listPivots();
  }

  @RequirePermission("reports.view")
  @ApiCreatedResponse({ type: SavedPivotDto })
  @Post("reports/pivots")
  createPivot(@Body() dto: SavedPivotInputDto) {
    return this.reports.createPivot(dto);
  }

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: SavedPivotDto })
  @Get("reports/pivots/:pivotId")
  getPivot(@Param("pivotId") id: string) {
    return this.reports.getPivot(id);
  }

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: SavedPivotDto })
  @Put("reports/pivots/:pivotId")
  updatePivot(@Param("pivotId") id: string, @Body() dto: SavedPivotUpdateDto) {
    return this.reports.updatePivot(id, dto);
  }

  @RequirePermission("reports.view")
  @HttpCode(204)
  @Delete("reports/pivots/:pivotId")
  async deletePivot(@Param("pivotId") id: string) {
    await this.reports.deletePivot(id);
  }

  @RequirePermission("reports.export")
  @ApiCreatedResponse({ type: ExportItemDto })
  @Post("reports/exports")
  requestExport(@Body() dto: ExportRequestDto) {
    return this.exportsService.request(dto);
  }

  @RequirePermission("reports.export")
  @ApiOkResponse({ type: ExportItemDto, isArray: true })
  @Get("reports/exports")
  listExports() {
    return this.exportsService.list();
  }

  @RequirePermission("reports.export")
  @ApiOkResponse({ type: ExportItemDto })
  @Get("reports/exports/:exportId")
  getExport(@Param("exportId") id: string) {
    return this.exportsService.get(id);
  }

  @RequirePermission("reports.export")
  @ApiProduces(
    "text/csv",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  @Get("reports/exports/:exportId/download")
  async download(@Param("exportId") id: string) {
    const f = await this.exportsService.download(id);
    return new StreamableFile(f.stream, {
      type: f.type,
      length: f.size,
      disposition: `attachment; filename="${f.fileName}"`,
    });
  }

  @RequirePermission("reports.view")
  @ApiOkResponse({ type: ReportResponseDto })
  @Get("reports/:id")
  report(@Param("id", REPORT_ID) id: ReportId, @Query() query: ReportQueryDto) {
    return this.reports.run(id, query);
  }
}
