// Operational limits (Specification §18.5). Revisit with measured iPad documents and exports.
export const LIMITS = {
  idLength: 100,
  idempotencyKeyLength: 200,
  titleLength: 200,
  bodyLength: 20_000,
  typeLength: 50,
  feedbackLength: 20_000,
  callouts: 20,
  calloutLength: 4_000,
  createProblemsBatch: 50,
  listPageSize: 100,
  // Includes JSON-RPC framing and JSON escaping for the largest permitted problem batch.
  authRequestBytes: 64 * 1024,
  mcpRequestBytes: 8 * 1024 * 1024,
  // Byte limits apply to the complete HTTP body, including JSON envelopes.
  canvasDocumentBytes: 4 * 1024 * 1024,
  snapshotImageBytes: 8 * 1024 * 1024,
  preferencesBytes: 16 * 1024,
  longPollSeconds: 6,
  longPollIntervalMs: 2000,
  longPollMaxChecks: 4,
} as const;
