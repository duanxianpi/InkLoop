-- Password sign-in replaces Passkeys. The browser stretches the password with PBKDF2-SHA256 using the
-- stored salt and iterations; the server keeps only SHA-256 of the stretched value. Owners of an
-- existing deployment set their first password with the recovery key.

CREATE TABLE owner_password (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  verifier TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Consecutive failed sign-ins and the earliest time the next attempt is accepted (Unix seconds).
CREATE TABLE login_throttle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  failures INTEGER NOT NULL,
  retry_after INTEGER NOT NULL
);
INSERT INTO login_throttle VALUES (1, 0, 0);

DROP TRIGGER guard_auth_operation;
DROP TABLE auth_operations;
DROP TABLE webauthn_challenges;
DROP TABLE passkeys;
