import { dashboardSummary, searchResponse } from "@erp/contracts";
import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { zodDto } from "../../common/dto.js";
import { SearchService } from "./search.service.js";

class SearchResponseDto extends zodDto("SearchResponseDto", searchResponse) {}
class SearchQueryDto extends zodDto(
  "SearchQueryDto",
  z.object({ q: z.string().trim().max(100).default("") }),
) {}
class DashboardSummaryDto extends zodDto("DashboardSummaryDto", dashboardSummary) {}

/** Signed-in users only; each section is filtered by the actor's permissions in the service. */
@ApiTags("search")
@Controller()
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @ApiOkResponse({ type: SearchResponseDto })
  @Get("search")
  search(@Query() query: SearchQueryDto) {
    return this.service.search(query.q);
  }

  @ApiOkResponse({ type: DashboardSummaryDto })
  @Get("dashboard/summary")
  dashboard() {
    return this.service.dashboard();
  }
}
