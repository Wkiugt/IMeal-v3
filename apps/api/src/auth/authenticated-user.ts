export interface AuthenticatedUser {
  id: string;
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  permissions: string[];
}

export interface EntraIdentity {
  userId: string;
  email: string;
  name?: string;
  tenantId: string;
}
