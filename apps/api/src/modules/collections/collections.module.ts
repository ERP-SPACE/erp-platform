import { Module } from "@nestjs/common";
import { SalesModule } from "../sales/sales.module.js";
import { CreditRecheckModule } from "../sales/credit-recheck.queue.js";
import { SeriesModule } from "../series/series.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AccountDocumentsController } from "./account-documents.controller.js";
import { AccountDocumentsService } from "./account-documents.service.js";
import {
  CommissionController,
  CreditControlController,
  PartyAccountsController,
  ReceiptsController,
  SupplierPaymentsController,
} from "./collections.controller.js";
import { CommissionModule } from "./commission.module.js";
import { ReceiptsService } from "./receipts.service.js";
import { StatementsService } from "./statements.service.js";

/** Stage 4: receipts and supplier payments, statements, aging, credit control, commission. */
@Module({
  imports: [SeriesModule, SettingsModule, SalesModule, CommissionModule, CreditRecheckModule],
  controllers: [
    AccountDocumentsController,
    ReceiptsController,
    SupplierPaymentsController,
    PartyAccountsController,
    CreditControlController,
    CommissionController,
  ],
  providers: [ReceiptsService, StatementsService, AccountDocumentsService],
  exports: [StatementsService],
})
export class CollectionsModule {}
