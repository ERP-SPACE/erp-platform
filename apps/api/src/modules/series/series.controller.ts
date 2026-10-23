import { seriesUpdateSchema } from "@erp/contracts";
import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { RequireFreshAuth, RequirePermission } from "../../auth/decorators.js";
import { SeriesItemDto, SeriesPreviewDto } from "../../common/responses.js";
import { SeriesService } from "./series.service.js";
import { zodDto } from "../../common/dto.js";

class UpdateSeriesDto extends zodDto("UpdateSeriesDto", seriesUpdateSchema) {}
class PreviewQueryDto extends zodDto(
  "PreviewQueryDto",
  z.object({
    type: z.string(),
    date: z.iso.date().optional(),
  }),
) {}

@ApiTags("document-series")
@Controller("document-series")
export class SeriesController {
  constructor(private readonly service: SeriesService) {}

  @RequirePermission("settings.series.view")
  @ApiOkResponse({ type: SeriesItemDto, isArray: true })
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission("settings.series.view")
  @ApiOkResponse({ type: SeriesPreviewDto })
  @Get("preview")
  preview(@Query() query: PreviewQueryDto) {
    return this.service.preview(query.type, query.date);
  }

  @RequirePermission("settings.series.update")
  @RequireFreshAuth()
  @ApiOkResponse({ type: SeriesItemDto })
  @Patch(":type")
  update(@Param("type") type: string, @Body() dto: UpdateSeriesDto) {
    return this.service.update(type, dto);
  }
}
