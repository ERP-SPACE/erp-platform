import { Controller, type MessageEvent, Sse } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { type Observable, filter, interval, map, merge } from "rxjs";
import { actor } from "../../common/context.js";
import { EventBus } from "./event-bus.js";

const HEARTBEAT_MS = 25_000;

@ApiTags("realtime")
@Controller("events")
export class RealtimeController {
  constructor(private readonly bus: EventBus) {}

  /** Server-sent events for the signed-in user's company; a heartbeat keeps proxies from idling out. */
  @Sse()
  stream(): Observable<MessageEvent> {
    this.bus.ensureSubscribed();
    const companyId = actor().companyId;
    const events = this.bus.events$.pipe(
      filter((event) => event.companyId === companyId),
      map((event): MessageEvent => ({ type: event.topic, data: event })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: "ping", data: String(Date.now()) })),
    );
    return merge(events, heartbeat);
  }
}
