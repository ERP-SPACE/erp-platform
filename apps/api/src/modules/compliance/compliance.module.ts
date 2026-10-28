import { Logger, Module } from "@nestjs/common";
import { ENV, type Env } from "../../config/env.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ComplianceController } from "./compliance.controller.js";
import { EINVOICE_PROVIDER, type EInvoiceProvider } from "./einvoice-provider.js";
import { EInvoiceQueue } from "./einvoice.queue.js";
import { EInvoiceService } from "./einvoice.service.js";
import { NicProvider } from "./nic.provider.js";
import { SimulatorProvider } from "./simulator.provider.js";

/** NIC sandbox when credentials are configured, else the offline simulator (ADR-0011). */
export function providerFromEnv(env: Env): EInvoiceProvider {
  const {
    NIC_CLIENT_ID,
    NIC_CLIENT_SECRET,
    NIC_USERNAME,
    NIC_PASSWORD,
    NIC_GSTIN,
    NIC_PUBLIC_KEY,
  } = env;
  if (
    NIC_CLIENT_ID &&
    NIC_CLIENT_SECRET &&
    NIC_USERNAME &&
    NIC_PASSWORD &&
    NIC_GSTIN &&
    NIC_PUBLIC_KEY
  ) {
    return new NicProvider({
      baseUrl: env.NIC_BASE_URL,
      clientId: NIC_CLIENT_ID,
      clientSecret: NIC_CLIENT_SECRET,
      username: NIC_USERNAME,
      password: NIC_PASSWORD,
      gstin: NIC_GSTIN,
      publicKey: NIC_PUBLIC_KEY,
    });
  }
  if (env.NODE_ENV === "production") {
    new Logger("Compliance").warn(
      "No NIC credentials: IRNs are SIMULATED and not reported to the IRP",
    );
  }
  return new SimulatorProvider();
}

/** E-invoicing and e-way bills (ADR-0011). */
@Module({
  imports: [SettingsModule],
  controllers: [ComplianceController],
  providers: [
    { provide: EINVOICE_PROVIDER, inject: [ENV], useFactory: providerFromEnv },
    EInvoiceService,
    EInvoiceQueue,
  ],
  exports: [EInvoiceService, EInvoiceQueue, EINVOICE_PROVIDER],
})
export class ComplianceModule {}
