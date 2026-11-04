-- Deleting a whole Problem removes its Snapshots and feedback with it. Snapshots and feedback stay
-- immutable on their own: a delete is allowed only while the parent Problem is listed here, which
-- happens only inside the deletion batch (src/server/services/organize.ts) and is cleared before it
-- commits.

CREATE TABLE problem_deletions (problem_id TEXT PRIMARY KEY);

DROP TRIGGER snapshots_retained;
CREATE TRIGGER snapshots_retained BEFORE DELETE ON snapshots
WHEN NOT EXISTS (SELECT 1 FROM problem_deletions WHERE problem_id = OLD.problem_id)
BEGIN SELECT RAISE(ABORT, 'snapshot_immutable'); END;

DROP TRIGGER feedback_retained;
CREATE TRIGGER feedback_retained BEFORE DELETE ON feedback
WHEN NOT EXISTS (SELECT 1 FROM problem_deletions WHERE problem_id = OLD.problem_id)
BEGIN SELECT RAISE(ABORT, 'feedback_append_only'); END;
