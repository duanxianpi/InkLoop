export interface OwnerIdentity {
  ownerId: number;
  authEpoch: number;
}
export interface McpIdentity extends OwnerIdentity {
  scopes: readonly string[];
  requireScope(scope: string): void;
}

export interface GrantProps extends OwnerIdentity {
  authorizationId: string;
}
