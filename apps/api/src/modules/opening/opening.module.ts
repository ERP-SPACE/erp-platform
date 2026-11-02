import { Module } from "@nestjs/common";
import { SeriesModule } from "../series/series.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { OpeningController } from "./opening.controller.js";
import { OpeningService } from "./opening.service.js";

/** Stage 6: the Opening Balance Wizard and the Go-Live lock. */
@Module({
  imports: [SeriesModule, SettingsModule],
  controllers: [OpeningController],
  providers: [OpeningService],
})
export class OpeningModule {}
