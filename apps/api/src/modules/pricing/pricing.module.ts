import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";

@Module({
  imports: [CustomersModule, SettingsModule],
  controllers: [PricingController],
  providers: [PricingService],
})
export class PricingModule {}
