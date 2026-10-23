import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "../../auth/decorators.js";
import { UpdateCompanyDto, UpdateSettingDto } from "./settings.dto.js";
import { SettingsService } from "./settings.service.js";

@ApiTags("settings")
@Controller()
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @RequirePermission("settings.view")
  @Get("settings")
  list() {
    return this.service.list();
  }

  @RequirePermission("settings.update")
  @Patch("settings/:key")
  update(@Param("key") key: string, @Body() dto: UpdateSettingDto) {
    return this.service.update(key, dto.value, dto.version);
  }

  @RequirePermission("settings.view")
  @Get("company")
  company() {
    return this.service.getCompany();
  }

  @RequirePermission("settings.company.update")
  @Patch("company")
  updateCompany(@Body() dto: UpdateCompanyDto) {
    return this.service.updateCompany(dto);
  }
}
