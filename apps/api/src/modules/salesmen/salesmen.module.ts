import { Module } from "@nestjs/common";
import { SalesmenController } from "./salesmen.controller.js";
import { SalesmenService } from "./salesmen.service.js";

@Module({
  controllers: [SalesmenController],
  providers: [SalesmenService],
  exports: [SalesmenService],
})
export class SalesmenModule {}
