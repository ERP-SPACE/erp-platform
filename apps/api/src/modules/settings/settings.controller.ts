import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import { CompanyResponseDto, SettingItemDto, SettingSavedDto } from "../../common/responses.js";
import { UpdateCompanyDto, UpdateSettingDto } from "./settings.dto.js";
import { SettingsService } from "./settings.service.js";

@ApiTags("settings")
@Controller()
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @RequirePermission("settings.view")
  @ApiOkResponse({ type: SettingItemDto, isArray: true })
  @Get("settings")
  list() {
    return this.service.list();
  }

  @RequirePermission("settings.update")
  @ApiOkResponse({ type: SettingSavedDto })
  @Patch("settings/:key")
  update(@Param("key") key: string, @Body() dto: UpdateSettingDto) {
    return this.service.update(key, dto.value, dto.version);
  }

  @RequirePermission("settings.view")
  @ApiOkResponse({ type: CompanyResponseDto })
  @Get("company")
  company() {
    return this.service.getCompany();
  }

  @RequirePermission("settings.company.update")
  @ApiOkResponse({ type: CompanyResponseDto })
  @Patch("company")
  updateCompany(@Body() dto: UpdateCompanyDto) {
    return this.service.updateCompany(dto);
  }
}
