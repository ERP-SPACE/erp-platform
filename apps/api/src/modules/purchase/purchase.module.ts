import { Module } from "@nestjs/common";
import { SeriesModule } from "../series/series.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { GoodsReceiptsService } from "./goods-receipts.service.js";
import { LandedCostService } from "./landed-cost.service.js";
import {
  GoodsReceiptsController,
  PurchaseInvoicesController,
  PurchaseOrdersController,
  PurchaseReturnsController,
} from "./purchase.controller.js";
import { PurchaseInvoicesService } from "./purchase-invoices.service.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";
import { PurchaseReturnsService } from "./purchase-returns.service.js";

/** Stage 2 purchase cycle: PO → GRN (rolls) → PI → landed cost → purchase return / DN. */
@Module({
  imports: [SeriesModule, SettingsModule],
  controllers: [
    PurchaseOrdersController,
    GoodsReceiptsController,
    PurchaseInvoicesController,
    PurchaseReturnsController,
  ],
  providers: [
    PurchaseOrdersService,
    GoodsReceiptsService,
    PurchaseInvoicesService,
    LandedCostService,
    PurchaseReturnsService,
  ],
})
export class PurchaseModule {}
