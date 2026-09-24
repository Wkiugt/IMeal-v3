export interface AuthenticatedUser {
  id: string;
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  permissions: string[];
}

export interface VerifiedOtpPrincipal {
  userId: string;
  email: string;
  name: string | null;
  challengeId: string;
  requestId: string;
  user: AuthenticatedUser;
}

export interface EntraIdentity {
  userId: string;
  email: string;
  name?: string;
  tenantId: string;
}
