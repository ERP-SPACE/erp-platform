import { Module } from "@nestjs/common";
import { CatalogueModule } from "../catalogue/catalogue.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { InventoryController } from "./inventory.controller.js";
import { LabelsService } from "./labels.service.js";
import { RollsService } from "./rolls.service.js";
import { StockService } from "./stock.service.js";

/** Stage 2 inventory: rolls, Roll Inspector, mapping, scrap, labels and stock views. */
@Module({
  imports: [CatalogueModule, SettingsModule],
  controllers: [InventoryController],
  providers: [RollsService, LabelsService, StockService],
  exports: [StockService],
})
export class InventoryModule {}
