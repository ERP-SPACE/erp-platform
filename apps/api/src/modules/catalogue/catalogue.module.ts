import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { CatalogueController } from "./catalogue.controller.js";
import { CatalogueService } from "./catalogue.service.js";

@Module({
  imports: [SettingsModule],
  controllers: [CatalogueController],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
