/** Bounded opportunistic cleanup, in the same D1 transaction as the next challenge insert. */
export const CHALLENGE_CLEANUP_BATCH = 32;

export function expiredChallengeCleanup(db: D1Database, cutoff: number): D1PreparedStatement[] {
  // Both statements select the same rows: deleting operations does not change this selection.
  // Remove the foreign-key children first. Unexpired ceremonies and their replay guards survive.
  const expired =
    'SELECT id FROM webauthn_challenges WHERE expires_at<=? ORDER BY expires_at,id LIMIT ?';
  return [
    db
      .prepare(`DELETE FROM auth_operations WHERE challenge_id IN (${expired})`)
      .bind(cutoff, CHALLENGE_CLEANUP_BATCH),
    db
      .prepare(`DELETE FROM webauthn_challenges WHERE id IN (${expired})`)
      .bind(cutoff, CHALLENGE_CLEANUP_BATCH),
  ];
}
