-- Product model (Specification §15). Timestamps are Unix milliseconds.
-- Single owner: authorization runs before services; write_guards re-checks the auth epoch inside
-- every product write batch.

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE problem_sets (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id),
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (collection_id, sort_order)
);

-- One live Canvas per Problem: canvas_* columns point at the current immutable R2 document object.
-- canvas_fingerprint is the browser-computed answer fingerprint of that document.
CREATE TABLE problems (
  id TEXT PRIMARY KEY,
  list_order INTEGER NOT NULL UNIQUE,
  set_id TEXT NOT NULL REFERENCES problem_sets(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT,
  sort_order INTEGER NOT NULL,
  answer_state TEXT NOT NULL DEFAULT 'working' CHECK (answer_state IN ('working', 'ready_for_review')),
  edit_epoch INTEGER NOT NULL DEFAULT 0,
  canvas_revision INTEGER NOT NULL DEFAULT 0,
  canvas_key TEXT,
  canvas_previous_key TEXT,
  canvas_fingerprint TEXT,
  has_content INTEGER NOT NULL DEFAULT 0,
  latest_snapshot_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (set_id, sort_order)
);
CREATE INDEX problems_by_set ON problems(set_id, sort_order);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  image_key TEXT NOT NULL UNIQUE,
  image_length INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (problem_id, sequence),
  UNIQUE (problem_id, id)
);
-- Sequences are allocated from the Problem row inside the commit batch; anything else aborts it.
CREATE TRIGGER snapshots_next_sequence BEFORE INSERT ON snapshots BEGIN
  SELECT CASE WHEN NEW.sequence IS NOT (SELECT latest_snapshot_seq + 1 FROM problems WHERE id = NEW.problem_id)
    THEN RAISE(ABORT, 'snapshot_sequence') END;
END;
CREATE TRIGGER snapshots_immutable BEFORE UPDATE ON snapshots BEGIN SELECT RAISE(ABORT, 'snapshot_immutable'); END;
CREATE TRIGGER snapshots_retained BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'snapshot_immutable'); END;

-- The composite foreign key makes feedback on another Problem's Snapshot impossible.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  list_order INTEGER NOT NULL UNIQUE,
  problem_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  verdict TEXT CHECK (verdict IN ('correct', 'partial', 'incorrect')),
  text TEXT NOT NULL,
  callouts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (problem_id, snapshot_id) REFERENCES snapshots(problem_id, id)
);
CREATE INDEX feedback_by_problem ON feedback(problem_id, list_order);
CREATE TRIGGER feedback_append_only BEFORE UPDATE ON feedback BEGIN SELECT RAISE(ABORT, 'feedback_append_only'); END;
CREATE TRIGGER feedback_retained BEFORE DELETE ON feedback BEGIN SELECT RAISE(ABORT, 'feedback_append_only'); END;

-- Scoped idempotency: a retry with the same key returns `result`; a different request is rejected.
CREATE TABLE idempotency (
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (operation, key)
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Advanced by every write that changes what pages display; pushed to open pages by the ChangeHub.
CREATE TABLE change_counter (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT INTO change_counter VALUES (1, 0);

-- Every product write batch starts by inserting a guard row and ends by deleting it. The trigger
-- aborts the whole batch when the auth epoch changed or the batch's precondition (ok) is false, so
-- preconditions are evaluated in the same transaction as the writes.
CREATE TABLE write_guards (
  id INTEGER PRIMARY KEY,
  auth_epoch INTEGER NOT NULL,
  ok INTEGER
);
CREATE TRIGGER check_write_guard BEFORE INSERT ON write_guards BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM auth_state WHERE id = 1 AND auth_epoch = NEW.auth_epoch)
    THEN RAISE(ABORT, 'auth_epoch_changed') END;
  SELECT CASE WHEN NEW.ok IS NOT 1 THEN RAISE(ABORT, 'precondition_failed') END;
END;
