import { Module } from "@nestjs/common";
import { SuppliersController, TransportersController } from "./suppliers.controller.js";
import { SuppliersService } from "./suppliers.service.js";

/** Suppliers and transporters (PRD §5.4) — both are simple party masters. */
@Module({
  controllers: [SuppliersController, TransportersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
