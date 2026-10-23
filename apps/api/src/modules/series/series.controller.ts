import { seriesUpdateSchema } from "@erp/contracts";
import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { RequireFreshAuth, RequirePermission } from "../../auth/decorators.js";
import { SeriesService } from "./series.service.js";

class UpdateSeriesDto extends createZodDto(seriesUpdateSchema) {}
class PreviewQueryDto extends createZodDto(
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
  @Get()
  list() {
    return this.service.list();
  }

  @RequirePermission("settings.series.view")
  @Get("preview")
  preview(@Query() query: PreviewQueryDto) {
    return this.service.preview(query.type, query.date);
  }

  @RequirePermission("settings.series.update")
  @RequireFreshAuth()
  @Patch(":type")
  update(@Param("type") type: string, @Body() dto: UpdateSeriesDto) {
    return this.service.update(type, dto);
  }
}
