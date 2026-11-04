import { api, ApiError } from '../api';
import { drafts, type Draft } from './drafts';

// One serial save queue per Problem (Architecture §7). Content is stored locally before any
// request; each request is tagged with the local version it confirms, and "saved" is reported only
// when the server acknowledged the newest version.

export type SaveStatus =
  | { kind: 'saved'; at: number | null }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'offline' }
  | { kind: 'failed' }
  | { kind: 'conflict'; code: ConflictCode };
export type ConflictCode = 'revision_conflict' | 'edit_epoch_changed' | 'canvas_locked';
const CONFLICTS = new Set<string>(['revision_conflict', 'edit_epoch_changed', 'canvas_locked']);

export interface Content {
  document: string;
  fingerprint: string;
  has_content: boolean;
}
export interface Base {
  revision: number;
  edit_epoch: number;
  fingerprint: string | null;
}

const SAVE_DELAY_MS = 1200;
const MAX_RETRY_MS = 30_000;

export class CanvasSync {
  status: SaveStatus = { kind: 'saved', at: null };
  private base: Base;
  private latest: (Content & { version: number }) | null = null;
  private version = 0;
  private sending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 0;
  private waiters: { resolve(): void; reject(error: unknown): void }[] = [];

  constructor(
    readonly problemId: string,
    base: Base,
    private onStatus: (sync: CanvasSync) => void,
  ) {
    this.base = { ...base };
  }

  /** Server state this queue writes on top of. */
  get current(): Readonly<Base> {
    return this.base;
  }
  /** Content not yet acknowledged by the server, if any. */
  get unsaved(): Readonly<Content> | null {
    return this.latest;
  }

  /**
   * Continue uploading a draft left by an earlier page load, on the revision and edit epoch it was
   * written against. If the server has moved on, the upload is rejected and the draft waits for an
   * explicit Keep / Load choice; it is never rebased silently.
   */
  restore(draft: Draft) {
    this.base = {
      revision: draft.base_revision,
      edit_epoch: draft.edit_epoch,
      fingerprint: this.base.fingerprint,
    };
    this.version = draft.version;
    this.latest = { ...draft, version: draft.version };
    this.setStatus({ kind: 'pending' });
    this.schedule(0);
  }

  /** Record new local content: stored on this device at once, uploaded after a short pause. */
  change(content: Content) {
    const same = this.latest
      ? this.latest.fingerprint === content.fingerprint && this.latest.document === content.document
      : content.fingerprint === this.base.fingerprint;
    if (same) return;
    this.version++;
    this.latest = { ...content, version: this.version };
    void drafts.put(this.draft(this.latest));
    if (this.status.kind === 'conflict') return; // Kept locally until the conflict is resolved.
    this.setStatus({ kind: 'pending' });
    this.schedule(SAVE_DELAY_MS);
  }

  /** Upload now and wait until the newest content is acknowledged. */
  async flush(): Promise<Base> {
    if (this.status.kind === 'conflict') throw new ApiError(409, this.status.code);
    if (!this.latest) return this.base;
    clearTimeout(this.timer);
    const done = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    void this.send();
    await done;
    return this.base;
  }

  /** The server moved on (Resume editing, or a confirmed reload). */
  rebase(base: Base) {
    this.base = { ...base };
    if (this.latest) void drafts.put(this.draft(this.latest));
  }

  /** Conflict recovery: write this device's content on top of the server's current revision. */
  keepLocal(base: Base) {
    this.rebase(base);
    this.setStatus({ kind: 'pending' });
    this.schedule(0);
  }

  /** Conflict recovery: drop this device's unsaved content. */
  async discardLocal(base: Base) {
    this.latest = null;
    this.base = { ...base };
    await drafts.remove(this.problemId);
    this.setStatus({ kind: 'saved', at: null });
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private draft(content: Content & { version: number }): Draft {
    return {
      problem_id: this.problemId,
      ...content,
      base_revision: this.base.revision,
      edit_epoch: this.base.edit_epoch,
      updated_at: Date.now(),
    };
  }

  private setStatus(status: SaveStatus) {
    this.status = status;
    this.onStatus(this);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.send(), ms);
  }

  private settleWaiters(error?: unknown) {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) error ? waiter.reject(error) : waiter.resolve();
  }

  private send(): Promise<void> {
    this.sending ??= this.upload().finally(() => (this.sending = null));
    return this.sending;
  }

  private async upload() {
    while (this.latest && this.status.kind !== 'conflict') {
      const content = this.latest;
      this.setStatus({ kind: 'saving' });
      try {
        const result = await api.saveCanvas(
          this.problemId,
          {
            base_revision: this.base.revision,
            edit_epoch: this.base.edit_epoch,
            fingerprint: content.fingerprint,
            has_content: content.has_content,
          },
          content.document,
        );
        this.retryMs = 0;
        this.base = { ...this.base, revision: result.revision, fingerprint: content.fingerprint };
        if (this.latest.version === content.version) {
          this.latest = null;
          await drafts.settle(this.problemId, content.version);
          this.setStatus({ kind: 'saved', at: Date.now() });
          this.settleWaiters();
        } else {
          // Newer content arrived meanwhile; its draft now builds on the acknowledged revision.
          void drafts.put(this.draft(this.latest));
        }
      } catch (error) {
        if (error instanceof ApiError && CONFLICTS.has(error.code)) {
          this.setStatus({ kind: 'conflict', code: error.code as ConflictCode });
        } else {
          this.setStatus({
            kind: error instanceof ApiError && error.offline ? 'offline' : 'failed',
          });
          this.retryMs = Math.min(MAX_RETRY_MS, Math.max(2000, this.retryMs * 2));
          this.schedule(this.retryMs);
        }
        this.settleWaiters(error);
        return;
      }
    }
  }

  /** Retry promptly when the browser reports connectivity again. */
  retrySoon() {
    if (this.latest && (this.status.kind === 'offline' || this.status.kind === 'failed')) {
      this.retryMs = 0;
      this.schedule(0);
    }
  }
}
