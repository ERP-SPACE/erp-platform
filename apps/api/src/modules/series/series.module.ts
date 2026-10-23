import { Module } from "@nestjs/common";
import { SeriesController } from "./series.controller.js";
import { SeriesService } from "./series.service.js";

@Module({ controllers: [SeriesController], providers: [SeriesService], exports: [SeriesService] })
export class SeriesModule {}
