export interface AuthenticatedUser {
  id: string;
  userId: string;
  email: string;
  name?: string;
  roles: string[];
  permissions: string[];
  /**
   * Present for principals resolved from an active database session.
   * OTP verification data is not an authenticated session yet.
   */
  sessionId?: string;
  isActive?: boolean;
}

export interface VerifiedOtpPrincipal {
  userId: string;
  email: string;
  name: string | null;
  challengeId: string;
  requestId: string;
  user: AuthenticatedUser;
}
