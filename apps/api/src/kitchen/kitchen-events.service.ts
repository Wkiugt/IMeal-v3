import { Injectable } from '@nestjs/common';
import { Subject, Observable, merge, interval } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import * as crypto from 'crypto';

export interface KitchenRealtimeEvent {
  eventId: string;
  eventType:
    | 'SERVING_CONFIRMED'
    | 'KITCHEN_SIGNAL_CHANGED'
    | 'DASHBOARD_SNAPSHOT'
    | 'HEARTBEAT';
  mealDate: string;
  occurredAt: string;
  requestId?: string;
  payload: any;
}

export interface SseMessageEvent {
  data: KitchenRealtimeEvent | { type: 'heartbeat'; timestamp: string };
  id?: string;
  type?: string;
  retry?: number;
}

@Injectable()
export class KitchenEventsService {
  private events$ = new Subject<KitchenRealtimeEvent>();
  private processedEventIds = new Set<string>();

  emitEvent(
    event: Omit<KitchenRealtimeEvent, 'eventId' | 'occurredAt'> & {
      eventId?: string;
      occurredAt?: string;
    },
  ) {
    if (event.eventId && this.isDuplicate(event.eventId)) {
      return {
        eventId: event.eventId,
        eventType: event.eventType,
        mealDate: event.mealDate,
        occurredAt: event.occurredAt || new Date().toISOString(),
        requestId: event.requestId,
        payload: event.payload,
      };
    }

    const fullEvent: KitchenRealtimeEvent = {
      eventId: event.eventId || crypto.randomUUID(),
      eventType: event.eventType,
      mealDate: event.mealDate,
      occurredAt: event.occurredAt || new Date().toISOString(),
      requestId: event.requestId,
      payload: event.payload,
    };

    this.processedEventIds.add(fullEvent.eventId);
    // Keep set bounded to last 1000 events
    if (this.processedEventIds.size > 1000) {
      const first = this.processedEventIds.values().next().value;
      if (first) this.processedEventIds.delete(first);
    }

    this.events$.next(fullEvent);
    return fullEvent;
  }

  isDuplicate(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  getEvents$(mealDate?: string): Observable<SseMessageEvent> {
    const eventStream = this.events$.asObservable().pipe(
      filter((evt) => !mealDate || evt.mealDate === mealDate),
      map((evt) => ({
        id: evt.eventId,
        type: evt.eventType,
        data: evt,
      })),
    );

    // Heartbeat every 15s to keep connections alive through proxies
    const heartbeatStream = interval(15000).pipe(
      map(() => ({
        type: 'HEARTBEAT',
        data: {
          type: 'heartbeat' as const,
          timestamp: new Date().toISOString(),
        },
      })),
    );

    return merge(eventStream, heartbeatStream);
  }
}
