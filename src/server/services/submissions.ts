import { DomainError } from '../../shared/errors';
import type { CommitResult, NotReady, ResumeResult, Submission } from '../../shared/model';
import { LIMITS } from '../../shared/limits';
import type { AppContext } from '../env';
import { lockConflict } from './canvas';
import { requireProblem, toSnapshot, type SnapshotRow } from './problems';
import {
  bumpCounter,
  commit,
  committedSeq,
  isUniqueViolation,
  newId,
  notify,
  now,
  record,
  replay,
  sha256,
} from './store';

// Mark ready, Resume editing and the latest committed Snapshot (Architecture §7–8).

/** Base64 PNG text with its exact length (Content-Length on upload, object size on read). */
export interface ImageText {
  body: ReadableStream<Uint8Array>;
  length: number;
}

const COMMIT = 'commit_snapshot';
interface StoredCommit {
  snapshot_id: string;
  reused: boolean;
}

// The first 32 base64 characters decode to the PNG signature, IHDR length/type, width and height.
const HEADER_CHARS = 32;
const PNG_START = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
];
const MAX_DIMENSION = 32_768;

function pngSize(head: Uint8Array): { width: number; height: number } {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(new TextDecoder().decode(head)), (c) => c.charCodeAt(0));
  } catch {
    throw new DomainError('invalid_request', 'Snapshot image must be base64 PNG text');
  }
  if (PNG_START.some((byte, index) => bytes[index] !== byte))
    throw new DomainError('invalid_request', 'Snapshot image must be a PNG');
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new DomainError('invalid_request', 'Snapshot image dimensions are out of range');
  return { width, height };
}

const BASE64_ALPHABET = new Uint8Array(256);
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')
  BASE64_ALPHABET[c.charCodeAt(0)] = 1;
const PAD = 0x3d; // '='

/**
 * The stored text is later placed verbatim inside a JSON string (get_submission), so every byte must
 * be base64: alphabet characters, then at most two '=' at the very end. Checked per chunk while
 * streaming; nothing is decoded. Total length (a multiple of 4) is checked before upload.
 */
class Base64Check {
  private padding = 0;
  accepts(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (this.padding) {
        if (byte !== PAD || ++this.padding > 2) return false;
      } else if (byte === PAD) this.padding = 1;
      else if (!BASE64_ALPHABET[byte]) return false;
    }
    return true;
  }
}

const invalidImage = () =>
  new DomainError('invalid_request', 'Snapshot image must be base64 PNG text');

/**
 * Read the header, then store header + remaining stream under `key`, checking that every byte is
 * base64 on the way. An invalid byte aborts the upload, so no object is written.
 */
async function storeImage(ctx: AppContext, key: string, image: ImageText) {
  const reader = image.body.getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  while (buffered < HEADER_CHARS) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    buffered += value.byteLength;
  }
  const head = new Uint8Array(buffered);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (buffered < HEADER_CHARS)
    throw new DomainError('invalid_request', 'Snapshot image is too short');
  const check = new Base64Check();
  let size;
  try {
    if (!check.accepts(head)) throw invalidImage();
    size = pngSize(head.subarray(0, HEADER_CHARS));
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const { readable, writable } = new FixedLengthStream(image.length);
  let invalid = false;
  const pump = (async () => {
    const writer = writable.getWriter();
    try {
      await writer.write(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!check.accepts(value)) {
          invalid = true;
          throw invalidImage();
        }
        await writer.write(value);
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  })();
  const [put, pumped] = await Promise.allSettled([
    ctx.storage.put(key, readable, { httpMetadata: { contentType: 'text/plain' } }),
    pump,
  ]);
  if (invalid) {
    await ctx.storage.delete(key).catch(() => undefined);
    throw invalidImage();
  }
  if (pumped.status === 'rejected') throw pumped.reason;
  if (put.status === 'rejected') throw put.reason;
  return size;
}

export function submissionService(ctx: AppContext) {
  async function result(problemId: string, stored: StoredCommit): Promise<CommitResult> {
    const [snapshot, problem] = await Promise.all([
      ctx.db
        .prepare('SELECT * FROM snapshots WHERE id = ?')
        .bind(stored.snapshot_id)
        .first<SnapshotRow>(),
      requireProblem(ctx, problemId),
    ]);
    return {
      problem_id: problemId,
      snapshot: toSnapshot(snapshot!),
      reused: stored.reused,
      answer_state: problem.answer_state,
    };
  }

  return {
    /**
     * Mark ready (§17.1). The browser saves first, then commits the PNG exported from that exact
     * revision. Content equal to the latest Snapshot reuses it (§9.1); otherwise the image is stored
     * and the sequence, Snapshot row and Ready state commit in one guarded D1 transaction.
     */
    async commit(
      problemId: string,
      expected: { revision: number; edit_epoch: number },
      idempotencyKey: string,
      image: ImageText | null,
    ): Promise<CommitResult> {
      const discardBody = () => image?.body.cancel().catch(() => undefined);
      const fingerprint = await sha256({ problemId, ...expected });
      const previous = await replay<StoredCommit>(ctx, COMMIT, idempotencyKey, fingerprint).catch(
        async (error) => {
          await discardBody();
          throw error;
        },
      );
      if (previous) {
        await discardBody();
        return result(problemId, previous);
      }

      const row = await requireProblem(ctx, problemId);
      const latest = row.latest_snapshot_seq
        ? await ctx.db
            .prepare('SELECT id, fingerprint FROM snapshots WHERE problem_id = ? AND sequence = ?')
            .bind(problemId, row.latest_snapshot_seq)
            .first<{ id: string; fingerprint: string }>()
        : null;
      const conflict =
        lockConflict(row, expected) ??
        (!row.has_content || !row.canvas_fingerprint
          ? new DomainError('empty_canvas', 'Write an answer before marking it ready')
          : null);
      const reuse = !conflict && latest?.fingerprint === row.canvas_fingerprint;
      if (conflict || reuse || !image) await discardBody();
      if (conflict) throw conflict;

      const condition = {
        sql: `EXISTS (SELECT 1 FROM problems WHERE id = ? AND answer_state = 'working' AND edit_epoch = ?
                AND canvas_revision = ? AND canvas_fingerprint = ? AND latest_snapshot_seq = ?)`,
        binds: [
          problemId,
          expected.edit_epoch,
          expected.revision,
          row.canvas_fingerprint,
          row.latest_snapshot_seq,
        ],
      };
      const time = now();
      let stored: StoredCommit;
      let statements: D1PreparedStatement[];
      let key: string | null = null;
      if (reuse) {
        stored = { snapshot_id: latest!.id, reused: true };
        statements = [
          ctx.db
            .prepare(
              `UPDATE problems SET answer_state = 'ready_for_review', updated_at = ? WHERE id = ?`,
            )
            .bind(time, problemId),
        ];
      } else {
        if (!image)
          throw new DomainError(
            'invalid_request',
            'The canvas changed; a Snapshot image is required',
          );
        if (image.length > LIMITS.snapshotImageBase64 || image.length % 4 !== 0) {
          await discardBody();
          throw new DomainError('invalid_request', 'Snapshot image has an invalid length');
        }
        const snapshotId = newId('snap');
        key = `snapshots/${problemId}/${snapshotId}.b64`;
        const size = await storeImage(ctx, key, image);
        stored = { snapshot_id: snapshotId, reused: false };
        statements = [
          ctx.db
            .prepare(
              `INSERT INTO snapshots (id, problem_id, sequence, image_key, image_length, width, height,
                 source_revision, fingerprint, created_at)
               SELECT ?, id, latest_snapshot_seq + 1, ?, ?, ?, ?, canvas_revision, canvas_fingerprint, ?
               FROM problems WHERE id = ?`,
            )
            .bind(snapshotId, key, image.length, size.width, size.height, time, problemId),
          ctx.db
            .prepare(
              `UPDATE problems SET latest_snapshot_seq = latest_snapshot_seq + 1,
                 answer_state = 'ready_for_review', updated_at = ? WHERE id = ?`,
            )
            .bind(time, problemId),
        ];
      }
      statements.push(record(ctx, COMMIT, idempotencyKey, fingerprint, stored), bumpCounter(ctx));

      const discardObject = () => key && ctx.storage.delete(key).catch(() => undefined);
      let committed;
      try {
        committed = await commit(ctx, condition, statements);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A concurrent retry with this key committed first; this object is not referenced.
          await discardObject();
          const winner = await replay<StoredCommit>(ctx, COMMIT, idempotencyKey, fingerprint);
          if (winner) return result(problemId, winner);
        }
        // Unknown outcome: keep the object for safe collection later.
        throw error;
      }
      if (!committed.ok) {
        await discardObject();
        const winner = await replay<StoredCommit>(ctx, COMMIT, idempotencyKey, fingerprint);
        if (winner) return result(problemId, winner);
        throw (
          lockConflict(await requireProblem(ctx, problemId), expected) ??
          new DomainError('revision_conflict', 'The canvas changed while marking it ready')
        );
      }
      await notify(ctx, committedSeq(committed.results.at(-1)));
      return result(problemId, stored);
    },

    /** Resume editing (§9.1); advances the epoch only on Ready → Working. */
    async resume(problemId: string): Promise<ResumeResult> {
      const row = await requireProblem(ctx, problemId);
      const unchanged = (current = row): ResumeResult => ({
        problem_id: problemId,
        answer_state: current.answer_state,
        edit_epoch: current.edit_epoch,
        revision: current.canvas_revision,
        resumed: false,
      });
      if (row.answer_state === 'working') return unchanged();
      const committed = await commit(
        ctx,
        {
          sql: `EXISTS (SELECT 1 FROM problems WHERE id = ? AND answer_state = 'ready_for_review' AND edit_epoch = ?)`,
          binds: [problemId, row.edit_epoch],
        },
        [
          ctx.db
            .prepare(
              `UPDATE problems SET answer_state = 'working', edit_epoch = edit_epoch + 1, updated_at = ? WHERE id = ?`,
            )
            .bind(now(), problemId),
          bumpCounter(ctx),
        ],
      );
      if (!committed.ok) return unchanged(await requireProblem(ctx, problemId));
      await notify(ctx, committedSeq(committed.results.at(-1)));
      return {
        problem_id: problemId,
        answer_state: 'working',
        edit_epoch: row.edit_epoch + 1,
        revision: row.canvas_revision,
        resumed: true,
      };
    },

    /**
     * The latest committed Snapshot, or an earlier one by ID; never the live draft (§10.3, §16.3).
     * `has_unsubmitted_changes` always compares the draft with the latest Snapshot.
     */
    async latest(problemId: string, snapshotId?: string): Promise<Submission | NotReady> {
      const row = await requireProblem(ctx, problemId);
      const question = { title: row.title, body: row.body, type: row.type };
      if (!row.latest_snapshot_seq && snapshotId)
        throw new DomainError('not_found', 'Snapshot not found for this problem');
      if (!row.latest_snapshot_seq)
        return {
          status: 'not_ready',
          problem_id: problemId,
          answer_state: row.answer_state,
          has_unsubmitted_changes: !!row.has_content,
          question,
        };
      const [latest, requested] = await ctx.db.batch<SnapshotRow>([
        ctx.db
          .prepare('SELECT * FROM snapshots WHERE problem_id = ? AND sequence = ?')
          .bind(problemId, row.latest_snapshot_seq),
        ctx.db
          .prepare('SELECT * FROM snapshots WHERE problem_id = ? AND id = ?')
          .bind(problemId, snapshotId ?? ''),
      ]);
      const latestSnapshot = latest.results[0];
      const snapshot = snapshotId ? requested.results[0] : latestSnapshot;
      if (!snapshot) throw new DomainError('not_found', 'Snapshot not found for this problem');
      const object = await ctx.storage.get(snapshot.image_key);
      if (!object) throw new DomainError('upload_failed', 'The Snapshot image is unavailable');
      return {
        status: 'ready',
        problem_id: problemId,
        snapshot_id: snapshot.id,
        sequence: snapshot.sequence,
        latest_sequence: latestSnapshot.sequence,
        created_at: new Date(snapshot.created_at).toISOString(),
        answer_state: row.answer_state,
        has_unsubmitted_changes: row.canvas_fingerprint !== latestSnapshot.fingerprint,
        question,
        image: { mimeType: 'image/png', body: object.body, length: object.size },
      };
    },

    async image(snapshotId: string): Promise<ImageText> {
      const row = await ctx.db
        .prepare('SELECT image_key FROM snapshots WHERE id = ?')
        .bind(snapshotId)
        .first<{ image_key: string }>();
      const object = row && (await ctx.storage.get(row.image_key));
      if (!object) throw new DomainError('not_found', 'Snapshot not found');
      return { body: object.body, length: object.size };
    },
  };
}
