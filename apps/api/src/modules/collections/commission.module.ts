import { Module } from "@nestjs/common";
import { SeriesModule } from "../series/series.module.js";
import { CommissionService } from "./commission.service.js";

/** Commission accrual and payouts; imported by sales (posting hooks) and collections. */
@Module({ imports: [SeriesModule], providers: [CommissionService], exports: [CommissionService] })
export class CommissionModule {}
