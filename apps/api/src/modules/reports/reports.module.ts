import { Module } from "@nestjs/common";
import { CollectionsModule } from "../collections/collections.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ExportsService } from "./exports.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { TodayService } from "./today.service.js";

/** Stage 5: Today, reports, pivot builder, saved pivots and exports. */
@Module({
  imports: [SettingsModule, SalesModule, CollectionsModule],
  controllers: [ReportsController],
  providers: [ReportsService, TodayService, ExportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
