import { Global, Module } from "@nestjs/common";
import { EventBus } from "./event-bus.js";
import { RealtimeController } from "./realtime.controller.js";

@Global()
@Module({ controllers: [RealtimeController], providers: [EventBus], exports: [EventBus] })
export class RealtimeModule {}
