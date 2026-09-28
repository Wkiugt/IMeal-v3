export type HealthCheckState = 'ok' | 'down' | 'not_configured';

export type ApiHealthChecks = {
  environment: HealthCheckState;
  database: HealthCheckState;
  migration: HealthCheckState;
  draining: HealthCheckState;
};

export type ApiHealthBody = {
  status: 'ok' | 'error';
  service: 'api';
  release: string | null;
  checks: ApiHealthChecks;
  requestId: string;
};

export type ApiHealthResult = {
  statusCode: 200 | 503;
  body: ApiHealthBody;
};

export type ShutdownRegistration = () => void;

export interface ShutdownCoordinatorLike {
  isDraining(): boolean;
  registerInFlight?(): ShutdownRegistration | undefined;
}

export const HEALTH_SHUTDOWN_COORDINATOR = Symbol(
  'HEALTH_SHUTDOWN_COORDINATOR',
);
export const HEALTH_ENVIRONMENT_VALIDATED = Symbol(
  'HEALTH_ENVIRONMENT_VALIDATED',
);
