/** JSON returned by the authenticated consent API; never contains keys or access tokens. */
export interface ConsentData {
  clientName: string;
  clientDomain: string | null;
  redirectHost: string;
  redirectIsLoopback: boolean;
  resource: string;
  scopes: string[];
  handle: string;
}
export type PasswordPurpose = 'setup' | 'login' | 'recovery' | 'change';
export type AuthPageData =
  | {
      kind: 'password';
      purpose: PasswordPurpose;
      initialized: boolean;
      origin: string;
      /** Before setup only: the deployment's D1 Studio page, when the deployment knows it. */
      d1ConsoleUrl?: string;
    }
  | ({ kind: 'consent' } & ConsentData)
  | { kind: 'connections' };

/**
 * The browser stretches the password with PBKDF2-SHA256 before sending it, so the Worker (10 ms CPU
 * on Workers Free) only hashes the stretched value once. Raise `iterations` for new passwords; stored
 * passwords keep the iterations they were created with.
 */
export const PASSWORD_KDF = {
  iterations: 600_000,
  minIterations: 600_000,
  maxIterations: 10_000_000,
};

/** Public parameters for signing in: the stored salt and iteration count. */
export interface PasswordParams {
  salt: string;
  iterations: number;
}
/** A new password as the server receives it. `derived` is base64url of the 32-byte PBKDF2 output. */
export interface PasswordCredential extends PasswordParams {
  derived: string;
}

/**
 * What each scope lets an AI app do, as the consent page states it. mcp:write includes the
 * delete tools, so the label must say that it can permanently remove the owner's work.
 */
export const SCOPE_LABELS: Record<string, string> = {
  'mcp:read': 'Read problems, submitted answers and feedback',
  'mcp:write':
    'Create, edit and permanently delete problems, including your handwriting, submitted answers and feedback on them; give feedback',
  offline_access: 'Stay connected without asking again',
};
