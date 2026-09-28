import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { defer, type Observable, tap } from 'rxjs';
import {
  establishRequestContext,
  runWithRequestContext,
  setResponseRequestId,
  type RequestContextReply,
  type RequestContextRequest,
} from './request-context.js';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestContextRequest>();
    const reply = http.getResponse<RequestContextReply>();
    const requestId = establishRequestContext(request, reply);

    return defer(() =>
      runWithRequestContext(requestId, () =>
        next.handle().pipe(tap(() => setResponseRequestId(reply, requestId))),
      ),
    );
  }
}
