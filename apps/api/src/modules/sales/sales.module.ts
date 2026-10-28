import { Module } from "@nestjs/common";
import { ComplianceModule } from "../compliance/compliance.module.js";
import { SeriesModule } from "../series/series.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ChallansService } from "./challans.service.js";
import { CreditService } from "./credit.service.js";
import { LedgerService } from "./ledger.service.js";
import { NotesService } from "./notes.service.js";
import { ProformasService } from "./proformas.service.js";
import {
  ChallansController,
  CustomerAccountController,
  NotesController,
  ProformasController,
  SalesInvoicesController,
  SalesOrdersController,
  SalesReturnsController,
} from "./sales.controller.js";
import { CreditRecheckConsumer } from "./credit-recheck.consumer.js";
import { CreditRecheckModule } from "./credit-recheck.queue.js";
import { PdfService } from "./pdf.service.js";
import { SalesDocumentsController } from "./sales-documents.controller.js";
import { SalesDocumentsService } from "./sales-documents.service.js";
import { SalesInvoicesService } from "./sales-invoices.service.js";
import { SalesOrdersService } from "./sales-orders.service.js";
import { SalesReturnsService } from "./sales-returns.service.js";

/** Stage 3 sales cycle: SO (credit) → DC (picking, cuts) → SI → returns / notes; proformas; ledger. */
@Module({
  imports: [SeriesModule, SettingsModule, ComplianceModule, CreditRecheckModule],
  controllers: [
    SalesOrdersController,
    ChallansController,
    SalesInvoicesController,
    ProformasController,
    SalesReturnsController,
    NotesController,
    CustomerAccountController,
    SalesDocumentsController,
  ],
  providers: [
    CreditService,
    SalesOrdersService,
    ChallansService,
    SalesInvoicesService,
    ProformasService,
    SalesReturnsService,
    NotesService,
    LedgerService,
    PdfService,
    CreditRecheckConsumer,
    SalesDocumentsService,
  ],
  exports: [CreditService, SalesInvoicesService, NotesService],
})
export class SalesModule {}
