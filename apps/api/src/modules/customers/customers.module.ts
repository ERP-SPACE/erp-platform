import { Module } from "@nestjs/common";
import { CreditRecheckModule } from "../sales/credit-recheck.queue.js";
import { SettingsModule } from "../settings/settings.module.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";

@Module({
  imports: [SettingsModule, CreditRecheckModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
