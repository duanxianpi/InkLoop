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
export type PasskeyPurpose = 'bootstrap' | 'recovery' | 'login' | 'add';
export type AuthPageData =
  | { kind: 'passkey'; purpose: PasskeyPurpose; initialized: boolean; origin: string }
  | ({ kind: 'consent' } & ConsentData)
  | { kind: 'connections' };
