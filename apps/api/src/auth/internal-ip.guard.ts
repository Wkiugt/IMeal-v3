import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { isTestAuthBypassEnabled } from '../config/environment.js';

@Injectable()
export class InternalIpGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (isTestAuthBypassEnabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const ip = request.ip || request.connection?.remoteAddress || '';

    if (this.isInternalIp(ip)) {
      return true;
    }

    throw new ForbiddenException('Access denied: Internal IP required.');
  }

  private isInternalIp(ip: string): boolean {
    if (!ip) return false;

    // Normalize IPv4-mapped IPv6
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    if (ip === '127.0.0.1' || ip === '::1') return true;

    const ipv4Regex = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
    const match = ip.match(ipv4Regex);
    if (match) {
      const parts = match.slice(1).map(Number);
      if (parts[0] === 10) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    }

    // IPv6 Unique Local / Link-local
    const lowerIp = ip.toLowerCase();
    if (
      lowerIp.startsWith('fd') ||
      lowerIp.startsWith('fc') ||
      lowerIp.startsWith('fe80')
    ) {
      return true;
    }

    return false;
  }
}
