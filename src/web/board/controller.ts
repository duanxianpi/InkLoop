import { api, ApiError, type StoredCanvas } from '../api';
import type {
  CollectionSummary,
  Preferences,
  ProblemDetail,
  ProblemSummary,
} from '../../shared/model';
import type { Camera, Engine, InkColor, Tool } from '../canvas/engine';
import { attachGestures } from '../canvas/gestures';
import { CanvasSync, type SaveStatus } from '../sync/canvasSync';
import { ChangeFeed } from '../sync/changeFeed';
import { drafts, savedCanvases } from '../sync/drafts';
import { createStore } from './store';
import { inSet } from './view';

// The board's state and behaviour. Components render the store and call these actions; the
// canvas adapter, save queues and change feed are driven from here.

export interface Prefs {
  hand: 'right' | 'left';
  eraserSticky: boolean;
  autoUnfold: boolean;
  color: InkColor;
  /** Only a stylus draws; fingers pan. Per device, so never sent to the account. */
  penMode: boolean;
}
export interface Ui {
  overview: boolean;
  /** Collection / set browsed in the Overview (null: the current problem's). */
  coll: string | null;
  set: string | null;
  /** Batch section the Overview scrolls to and highlights. */
  batch: string | null;
  collMenu: boolean;
  /** The question unfolded in the Question Bar. */
  qpop: boolean;
  fb: boolean;
  fbSel: string | null;
  settings: boolean;
  colors: boolean;
}
export interface BoardState {
  phase: 'loading' | 'ready' | 'error';
  collections: CollectionSummary[];
  problems: ProblemSummary[];
  details: Record<string, ProblemDetail>;
  currentId: string | null;
  newIds: string[];
  prefs: Prefs;
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  /** The current canvas has strokes. */
  hasInk: boolean;
  /** Answer fingerprint of the current canvas, as last captured. */
  fingerprint: string | null;
  canvas: 'loading' | 'ready' | 'unavailable';
  save: SaveStatus;
  marking: boolean;
  ui: Ui;
  narrow: boolean;
  hint: { id: number; text: string } | null;
}

const CLOSED: Ui = {
  overview: false,
  coll: null,
  set: null,
  batch: null,
  collMenu: false,
  qpop: false,
  fb: false,
  fbSel: null,
  settings: false,
  colors: false,
};
const DEFAULT_PREFS: Prefs = {
  hand: 'right',
  eraserSticky: false,
  autoUnfold: false,
  color: 'black',
  penMode: true,
};
const LOCKED_HINT = 'Ready for Review. Resume editing to make changes.';
const CAPTURE_DELAY_MS = 800;
const NARROW = 600;
/** The question tile's layout scale (--z on .paper); the camera scales it by zoom / TILE_SCALE. */
const TILE_SCALE = 2;

// Per-browser conveniences (Architecture §6): never authoritative, so failures are ignored.
const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const value = localStorage.getItem('inkloop:' + key);
      return value === null ? fallback : (JSON.parse(value) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem('inkloop:' + key, JSON.stringify(value));
    } catch {
      // Storage full or blocked.
    }
  },
};

type SavedCamera = Camera & { w: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class BoardController {
  readonly store = createStore<BoardState>({
    phase: 'loading',
    collections: [],
    problems: [],
    details: {},
    currentId: null,
    newIds: local.get<string[]>('new', []),
    prefs: { ...DEFAULT_PREFS, ...local.get<Partial<Prefs>>('prefs', {}) },
    tool: 'draw',
    canUndo: false,
    canRedo: false,
    hasInk: false,
    fingerprint: null,
    canvas: 'loading',
    save: { kind: 'saved', at: null },
    marking: false,
    ui: CLOSED,
    narrow: innerWidth < NARROW,
    hint: null,
  });
  private engine: Engine | null = null;
  private engineWaiters: ((engine: Engine) => void)[] = [];
  private detachGestures: (() => void) | null = null;
  private feed = new ChangeFeed(() => void this.refresh());
  private syncs = new Map<string, CanvasSync>();
  /** Latest document text per problem seen in this page, for instant switching. */
  private documents = new Map<string, string>();
  private cameras = local.get<Record<string, SavedCamera>>('cameras', {});
  private commitKeys = new Map<string, string>();
  private showToken = 0;
  private penDown = false;
  private dirty = false;
  private captureTimer: ReturnType<typeof setTimeout> | undefined;
  private cameraTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshPending = false;
  private refreshing: Promise<void> | null = null;
  private hintAt = 0;
  private toastId = 0;
  private auto = { opened: false, declined: false };
  /** The current camera is the untouched default, so it follows the tile's measured height. */
  private defaultCamera = false;
  private tileHeight = 220;
  private world: { world: HTMLElement; paper: HTMLElement; under: HTMLElement } | null = null;
  private tile: HTMLElement | null = null;
  private qrow: HTMLElement | null = null;
  private frame = 0;
  private stopped = false;
  private needsOfflineReads =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    !navigator.serviceWorker.controller;
  private cachingOfflineReads = false;

  get state() {
    return this.store.get();
  }
  private set(patch: Partial<BoardState> | ((state: BoardState) => Partial<BoardState>)) {
    this.store.set(patch);
  }
  private ui(patch: Partial<Ui>) {
    this.set((state) => ({ ui: { ...state.ui, ...patch } }));
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKey, true);
    addEventListener('online', this.onOnline);
    addEventListener('pagehide', this.onHide);
    document.addEventListener('visibilitychange', this.onHide);
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.addEventListener('controllerchange', this.cacheOfflineReads);
    try {
      const [preferences, { collections }, problems] = await Promise.all([
        api.preferences().catch(() => ({}) as Preferences),
        api.collections(),
        api.allProblems(),
      ]);
      const prefs = { ...this.state.prefs, ...fromPreferences(preferences) };
      local.set('prefs', prefs);
      const known = local.get<string[] | null>('known', null);
      const newIds = known
        ? [
            ...new Set([
              ...this.state.newIds,
              ...problems.map((p) => p.id).filter((id) => !known.includes(id)),
            ]),
          ]
        : [];
      this.remember(problems, newIds);
      const stored = local.get<string | null>('current', null);
      const currentId = problems.some((p) => p.id === stored) ? stored : defaultProblem(problems);
      this.set({ phase: 'ready', prefs, collections, problems, newIds, currentId });
      this.feed.start();
      if (this.engine) this.applyPrefs(this.engine);
      if (currentId) await this.open(currentId);
      void this.cacheOfflineReads();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) this.set({ phase: 'error' });
    }
  }

  stop() {
    this.stopped = true;
    this.captureNow();
    this.saveCamera();
    this.feed.stop();
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.removeEventListener('controllerchange', this.cacheOfflineReads);
    this.syncs.forEach((sync) => sync.dispose());
    this.detachGestures?.();
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('online', this.onOnline);
    removeEventListener('pagehide', this.onHide);
    document.removeEventListener('visibilitychange', this.onHide);
  }

  retry() {
    this.set({ phase: 'loading' });
    void this.start();
  }

  attachEngine(engine: Engine) {
    this.engine = engine;
    this.applyPrefs(engine);
    engine.load(null, true);
    this.detachGestures = attachGestures(engine, engine.container, {
      penMode: () => this.state.prefs.penMode,
      strokeStart: this.strokeStart,
      strokeEnd: this.strokeEnd,
      lockedAttempt: () => this.hint(LOCKED_HINT, true),
    });
    // Any direct camera interaction keeps the current camera instead of the computed default.
    const touched = () => (this.defaultCamera = false);
    engine.container.addEventListener('wheel', touched, { passive: true });
    engine.container.addEventListener('pointerdown', touched, true);
    this.engineWaiters.splice(0).forEach((resolve) => resolve(engine));
  }

  detachEngine() {
    this.captureNow();
    this.detachGestures?.();
    this.detachGestures = null;
    this.engine = null;
  }

  private engineReady(): Promise<Engine> {
    return this.engine
      ? Promise.resolve(this.engine)
      : new Promise((resolve) => this.engineWaiters.push(resolve));
  }

  private applyPrefs(engine: Engine) {
    engine.eraserSticky = this.state.prefs.eraserSticky;
    engine.setColor(this.state.prefs.color);
    engine.setPenMode(this.state.prefs.penMode);
  }

  /** Engine callbacks. */
  readonly events = {
    onDocumentChange: () => {
      this.dirty = true;
      const hasInk = (this.engine?.count() ?? 0) > 0;
      if (hasInk !== this.state.hasInk) this.set({ hasInk });
      this.scheduleCapture();
    },
    onCamera: (camera: Camera) => this.onCamera(camera),
    onHistory: (canUndo: boolean, canRedo: boolean) => {
      if (canUndo !== this.state.canUndo || canRedo !== this.state.canRedo)
        this.set({ canUndo, canRedo });
    },
    onTool: (tool: Tool) => this.set({ tool }),
  };

  private strokeStart = () => {
    this.penDown = true;
    this.store.hold();
  };
  private strokeEnd = () => {
    this.penDown = false;
    this.store.release();
    if (this.dirty) this.scheduleCapture();
    if (this.refreshPending) {
      this.refreshPending = false;
      void this.refresh();
    }
  };

  // ---------------------------------------------------------------- layout and camera

  registerWorld(world: HTMLElement | null, paper: HTMLElement | null, under: HTMLElement | null) {
    this.world = world && paper && under ? { world, paper, under } : null;
    paper?.style.setProperty('--z', String(TILE_SCALE));
    if (paper) paper.style.transform = `scale(${1 / TILE_SCALE})`; // Zoom 1 until the camera reports.
    if (this.engine) this.onCamera(this.engine.getCamera());
  }
  registerQuestionRow(element: HTMLElement | null) {
    this.qrow = element;
  }
  /** The printed question tile; its height positions the default camera. */
  registerTile(element: HTMLElement | null) {
    this.tile = element;
  }
  /** `height` is as laid out, at TILE_SCALE; the tile is stored at zoom 1. */
  tileResized(height: number) {
    height /= TILE_SCALE;
    if (!height || Math.abs(height - this.tileHeight) < 2) return;
    this.tileHeight = height;
    if (this.defaultCamera && this.engine && this.state.canvas === 'ready')
      this.engine.setCamera(this.defaultCameraFor());
  }

  private onCamera(camera: Camera) {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.world) {
        const { world, paper, under } = this.world;
        // Whole device pixels: a fractional offset resamples the printed question and blurs it.
        const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
        world.style.transform = `translate(${snap(camera.x)}px, ${snap(camera.y)}px)`;
        // Laid out once at TILE_SCALE and only scaled here, so zooming never reflows it (see .qtile).
        paper.style.transform = `scale(${camera.z / TILE_SCALE})`;
        const grid = 28 * camera.z;
        under.style.backgroundSize = `${grid}px ${grid}px`;
        under.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
      }
      this.autoUnfold();
    });
    clearTimeout(this.cameraTimer);
    this.cameraTimer = setTimeout(() => this.saveCamera(), 1500);
  }

  private defaultCameraFor(): Camera {
    const width = innerWidth;
    const narrow = width < NARROW;
    const { hand } = this.state.prefs;
    // Screen pixels clear of the tool rail.
    const rail = 72;
    const left = narrow ? 9 : hand === 'right' ? rail : 18;
    const right = narrow ? 9 : hand === 'left' ? rail : 18;
    const z = clamp((width - left - right) / 480, 0.5, 1);
    return { x: left, y: 60 + (this.tileHeight + 30) * z, z };
  }

  private saveCamera() {
    const id = this.state.currentId;
    if (!id || !this.engine || this.state.canvas !== 'ready') return;
    this.cameras[id] = { ...this.engine.getCamera(), w: innerWidth };
    const entries = Object.entries(this.cameras);
    if (entries.length > 300) this.cameras = Object.fromEntries(entries.slice(-300));
    local.set('cameras', this.cameras);
  }

  /** Share of the question tile that is on screen; the bar's own row hides part of it. */
  private tileShown() {
    const tile = this.tile?.getBoundingClientRect();
    if (!tile?.width || !tile.height) return 1;
    const area = (a: DOMRect | Rect, b: DOMRect | Rect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    let hidden = 0;
    const row = this.qrow?.getBoundingClientRect();
    if (row)
      hidden = area(tile, {
        left: Math.max(0, row.left),
        top: Math.max(0, row.top),
        right: Math.min(innerWidth, row.right),
        bottom: Math.min(innerHeight, row.bottom),
      });
    return Math.max(0, area(tile, view) - hidden) / (tile.width * tile.height);
  }

  /**
   * Unfold the question once less than 25% of its tile is visible; fold it when 40% is visible
   * again. A manual fold is respected until the tile returns (§5.3).
   */
  private autoUnfold() {
    const { prefs, ui, currentId, canvas } = this.state;
    if (!prefs.autoUnfold || !currentId || canvas !== 'ready' || this.penDown) return;
    const shown = this.tileShown();
    if (shown < 0.25 && !ui.qpop && !this.auto.opened && !this.auto.declined && !ui.overview) {
      this.auto.opened = true;
      this.ui({ qpop: true });
    } else if (shown >= 0.4) {
      this.auto.declined = false;
      if (this.auto.opened) {
        this.auto.opened = false;
        if (ui.qpop) this.ui({ qpop: false });
      }
    }
  }

  private onResize = () => {
    const narrow = innerWidth < NARROW;
    if (narrow !== this.state.narrow) this.set({ narrow });
    if (this.defaultCamera && this.engine && this.state.canvas === 'ready')
      this.engine.setCamera(this.defaultCameraFor());
  };

  // ---------------------------------------------------------------- navigation

  go(id: string, keepQuestion = false) {
    if (!this.state.problems.some((p) => p.id === id)) return;
    if (id === this.state.currentId) {
      this.ui({ overview: false, collMenu: false });
      return;
    }
    this.captureNow();
    this.saveCamera();
    if (!keepQuestion) this.auto = { opened: false, declined: false };
    this.set((state) => ({
      currentId: id,
      ui: { ...CLOSED, qpop: keepQuestion && state.ui.qpop },
    }));
    void this.open(id);
  }

  step(direction: -1 | 1) {
    const current = this.currentSummary();
    if (!current) return;
    const list = inSet(this.state.problems, current.set_id);
    const next = list[list.indexOf(current) + direction];
    if (next) this.go(next.id, true);
  }

  private currentSummary() {
    return this.state.problems.find((p) => p.id === this.state.currentId);
  }

  /** Show a problem's canvas: local unsaved content first, otherwise the stored document. */
  private async open(id: string, keepCamera = false) {
    const token = ++this.showToken;
    // Opening a problem is what makes it seen.
    local.set('current', id);
    if (this.state.newIds.includes(id)) {
      const newIds = this.state.newIds.filter((value) => value !== id);
      local.set('new', newIds);
      this.set({ newIds });
    }
    const engine = await this.engineReady();
    if (token !== this.showToken) return;
    const cached = this.documents.get(id);
    clearTimeout(this.captureTimer);
    this.dirty = false;
    engine.load(cached ?? null, true);
    this.set({ canvas: 'loading', hasInk: cached ? engine.count() > 0 : false });
    const camera = keepCamera ? engine.getCamera() : null;

    const [detail, stored, draft] = await Promise.all([
      api.problem(id).catch((error: unknown) => error as ApiError),
      api.canvas(id).catch((error: unknown) => error as ApiError),
      drafts.get(id),
    ]);
    if (token !== this.showToken) return;
    if (!(detail instanceof ApiError)) this.setDetail(detail);
    const knownDetail = detail instanceof ApiError ? this.state.details[id] : detail;

    let sync = this.syncs.get(id);
    let document: string | null = null;
    let locked = knownDetail?.answer_state === 'ready_for_review';
    if (stored instanceof ApiError) {
      // Offline: continue from this device's newest copy, always together with the revision it
      // belongs to. An upload can then only conflict with newer server content, never replace it.
      const saved = sync || draft ? null : await savedCanvases.get(id);
      if (token !== this.showToken) return;
      document = sync?.unsaved?.document ?? draft?.document ?? cached ?? saved?.document ?? null;
      if (!document && knownDetail?.has_content !== false) {
        this.set({ canvas: 'unavailable' });
        return;
      }
      if (!sync && draft) {
        sync = this.createSync(id, {
          revision: draft.base_revision,
          edit_epoch: draft.edit_epoch,
          fingerprint: null,
        });
        sync.restore(draft);
      } else if (!sync && saved) {
        sync = this.createSync(id, {
          revision: saved.revision,
          edit_epoch: saved.edit_epoch,
          fingerprint: saved.fingerprint,
        });
      }
    } else {
      void savedCanvases.put({
        problem_id: id,
        document: stored.document,
        fingerprint: stored.meta.fingerprint,
        revision: stored.meta.revision,
        edit_epoch: stored.meta.edit_epoch,
      });
      locked = stored.meta.answer_state === 'ready_for_review';
      document = this.chooseDocument(id, stored, sync, draft);
      sync = this.syncs.get(id);
    }
    if (token !== this.showToken) return;

    try {
      engine.load(document, locked);
    } catch {
      this.set({ canvas: 'unavailable' });
      return;
    }
    if (document) this.documents.set(id, document);
    const saved = this.cameras[id];
    this.defaultCamera = false;
    if (camera) engine.setCamera(camera);
    else if (saved && saved.w === innerWidth) engine.setCamera(saved);
    else {
      engine.setCamera(this.defaultCameraFor());
      this.defaultCamera = true;
    }
    const captured = engine.capture();
    this.set({
      canvas: 'ready',
      hasInk: captured.has_content,
      fingerprint: captured.fingerprint,
      save: sync?.status ?? { kind: 'saved', at: null },
    });
    engine.setTool(this.state.tool);
  }

  private chooseDocument(
    id: string,
    stored: StoredCanvas,
    sync: CanvasSync | undefined,
    draft: Awaited<ReturnType<typeof drafts.get>>,
  ): string | null {
    const { meta } = stored;
    const base = {
      revision: meta.revision,
      edit_epoch: meta.edit_epoch,
      fingerprint: meta.fingerprint,
    };
    if (sync) {
      const unsaved = sync.unsaved;
      // Unsaved content written on top of what the server still has: keep editing it.
      if (
        unsaved &&
        sync.current.revision === meta.revision &&
        sync.current.edit_epoch === meta.edit_epoch &&
        meta.answer_state === 'working'
      )
        return unsaved.document;
      if (!unsaved) sync.rebase(base);
      return stored.document;
    }
    sync = this.createSync(id, base);
    if (draft && draft.fingerprint !== meta.fingerprint) {
      // The draft keeps its own base: built on an older revision or epoch, its upload is rejected
      // and shows as a conflict instead of overwriting newer content.
      sync.restore(draft);
      if (
        draft.base_revision === meta.revision &&
        draft.edit_epoch === meta.edit_epoch &&
        meta.answer_state === 'working'
      )
        return draft.document;
    } else if (draft) void drafts.remove(id);
    return stored.document;
  }

  private createSync(id: string, base: ConstructorParameters<typeof CanvasSync>[1]) {
    const sync = new CanvasSync(id, base, (changed) => {
      if (changed.problemId === this.state.currentId) this.set({ save: changed.status });
    });
    this.syncs.set(id, sync);
    return sync;
  }

  private setDetail(detail: ProblemDetail) {
    this.set((state) => ({
      details: { ...state.details, [detail.id]: detail },
      problems: state.problems.map((problem) =>
        problem.id === detail.id ? { ...problem, ...summaryOf(detail) } : problem,
      ),
    }));
  }

  // ---------------------------------------------------------------- drawing and saving

  private scheduleCapture() {
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => {
      if (this.penDown) return; // strokeEnd reschedules.
      this.captureNow();
    }, CAPTURE_DELAY_MS);
  }

  /** Serialize the current canvas into its save queue (stored locally at once). */
  private captureNow() {
    clearTimeout(this.captureTimer);
    const id = this.state.currentId;
    if (!this.dirty || !this.engine || !id || this.state.canvas !== 'ready') return null;
    this.dirty = false;
    const content = this.engine.capture();
    this.documents.set(id, content.document);
    // tldraw also reports bookkeeping changes (after a load, say); only answer changes are saved.
    if (content.fingerprint === this.state.fingerprint) return content;
    const sync =
      this.syncs.get(id) ?? this.createSync(id, { revision: 0, edit_epoch: 0, fingerprint: null });
    sync.change(content);
    this.set({ fingerprint: content.fingerprint, hasInk: content.has_content });
    return content;
  }

  /** Reads made before first control did not reach the worker. Warm its data cache without
   * applying the responses to the board, moving the camera, or replacing any local ink. */
  private cacheOfflineReads = async () => {
    if (
      this.stopped ||
      !this.needsOfflineReads ||
      this.cachingOfflineReads ||
      this.state.phase !== 'ready' ||
      !navigator.serviceWorker.controller
    )
      return;
    this.cachingOfflineReads = true;
    try {
      const ids = new Set(Object.keys(this.state.details));
      if (this.state.currentId) ids.add(this.state.currentId);
      await Promise.all([
        api.preferences(),
        api.collections(),
        api.allProblems(),
        ...[...ids].map((id) => api.problem(id)),
      ]);
      this.needsOfflineReads = false;
    } catch {
      // A later online event retries; the open board and its save queues are unaffected.
    } finally {
      this.cachingOfflineReads = false;
    }
  };

  private onOnline = () => {
    this.syncs.forEach((sync) => sync.retrySoon());
    void this.cacheOfflineReads();
  };
  private onHide = () => {
    if (document.visibilityState === 'hidden' || !document.visibilityState) {
      this.captureNow();
      this.saveCamera();
    }
  };

  setTool(tool: Tool) {
    if (this.engine?.isLocked) return;
    this.engine?.setTool(tool);
    this.set({ tool });
  }
  setColor(color: InkColor) {
    this.engine?.setColor(color);
    this.engine?.setTool('draw');
    this.set((state) => ({ tool: 'draw', ui: { ...state.ui, colors: false } }));
    this.setPrefs({ color });
  }
  undo() {
    this.engine?.undo();
  }
  redo() {
    this.engine?.redo();
  }

  setPrefs(patch: Partial<Prefs>) {
    const prefs = { ...this.state.prefs, ...patch };
    local.set('prefs', prefs);
    this.set({ prefs });
    if (this.engine) this.applyPrefs(this.engine);
    if (patch.autoUnfold === false && this.auto.opened) {
      this.auto.opened = false;
      this.ui({ qpop: false });
    }
    const values = toPreferences(patch);
    if (Object.keys(values).length) void api.updatePreferences(values).catch(() => undefined);
  }

  // ---------------------------------------------------------------- answer state

  /**
   * Mark ready (§9, Architecture §7): freeze one document, make sure that exact revision is saved,
   * then commit its image (or reuse the identical latest Snapshot). Ready is shown only after the
   * server confirms; any failure leaves the canvas editable with nothing lost.
   */
  async markReady() {
    const id = this.state.currentId;
    const engine = this.engine;
    if (!id || !engine || this.state.marking || engine.isLocked || !this.state.hasInk) return;
    this.set({ marking: true });
    engine.setLocked(true);
    let ready = false;
    try {
      this.dirty = true;
      const content = this.captureNow() ?? engine.capture();
      const sync = this.syncs.get(id)!;
      const base = await sync.flush();
      const latest = this.state.details[id]?.snapshots.at(-1);
      const reuse = latest?.fingerprint === content.fingerprint;
      const scope = `${id}:${base.revision}:${base.edit_epoch}`;
      const key = this.commitKeys.get(scope) ?? crypto.randomUUID();
      this.commitKeys.set(scope, key);
      const commit = async (image: string | null) => api.commit(id, base, key, image);
      try {
        await commit(reuse ? null : await engine.exportPng());
      } catch (error) {
        // The server knows best whether the content is unchanged.
        if (!(reuse && error instanceof ApiError && error.code === 'invalid_request')) throw error;
        await commit(await engine.exportPng());
      }
      ready = true;
      this.commitKeys.delete(scope);
      if (this.state.currentId === id)
        this.set({ ui: { ...this.state.ui, fb: false, fbSel: null } });
      await this.reloadDetail(id);
    } catch (error) {
      this.hint(
        error instanceof ApiError && error.offline
          ? 'Connection unavailable. Your drawing is kept on this device; try again.'
          : error instanceof ApiError && error.code === 'canvas_locked'
            ? 'This answer was already marked ready on another device.'
            : "Couldn't mark ready. Your drawing is safe; try again.",
      );
      if (error instanceof ApiError && error.code === 'canvas_locked') void this.reloadCurrent();
    } finally {
      if (this.state.currentId === id && this.engine === engine) engine.setLocked(ready);
      this.set({ marking: false });
    }
  }

  async resume() {
    const id = this.state.currentId;
    const engine = this.engine;
    if (!id || !engine || this.state.marking) return;
    try {
      const result = await api.resume(id);
      const sync = this.syncs.get(id);
      sync?.rebase({
        revision: result.revision,
        edit_epoch: result.edit_epoch,
        fingerprint: sync.current.fingerprint,
      });
      await savedCanvases.advanceEpoch(id, result.revision, result.edit_epoch);
      if (this.state.currentId === id) {
        engine.setLocked(result.answer_state === 'ready_for_review');
        engine.setTool('draw');
        engine.setColor(this.state.prefs.color);
        this.set({ tool: 'draw' });
      }
      await this.reloadDetail(id);
    } catch (error) {
      this.hint(
        error instanceof ApiError && error.offline
          ? 'Connection unavailable. Try again when you are back online.'
          : "Couldn't resume editing. Try again.",
      );
    }
  }

  /** Conflict recovery from the status line. */
  async keepLocal() {
    const id = this.state.currentId;
    const sync = id ? this.syncs.get(id) : undefined;
    if (!id || !sync?.unsaved || !this.engine) return;
    try {
      const { meta } = await api.canvas(id);
      if (meta.answer_state === 'ready_for_review') {
        this.hint(LOCKED_HINT);
        return;
      }
      this.engine.load(sync.unsaved.document, false);
      this.documents.set(id, sync.unsaved.document);
      sync.keepLocal({
        revision: meta.revision,
        edit_epoch: meta.edit_epoch,
        fingerprint: meta.fingerprint,
      });
      const captured = this.engine.capture();
      this.set({ hasInk: captured.has_content, fingerprint: captured.fingerprint });
    } catch {
      this.hint('Connection unavailable. Try again.');
    }
  }
  async discardLocal() {
    const id = this.state.currentId;
    const sync = id ? this.syncs.get(id) : undefined;
    if (!id || !sync) return;
    try {
      const { meta } = await api.canvas(id);
      await sync.discardLocal({
        revision: meta.revision,
        edit_epoch: meta.edit_epoch,
        fingerprint: meta.fingerprint,
      });
      this.documents.delete(id);
      await this.reloadCurrent();
    } catch {
      this.hint('Connection unavailable. Try again.');
    }
  }

  private async reloadDetail(id: string) {
    try {
      this.setDetail(await api.problem(id));
    } catch {
      // The change feed catches up later.
    }
  }

  retryCanvas() {
    void this.reloadCurrent();
  }

  private async reloadCurrent() {
    const id = this.state.currentId;
    if (!id) return;
    this.saveCamera();
    await this.open(id, true);
  }

  // ---------------------------------------------------------------- live updates

  /** Remote changes never switch the problem, move the camera or interrupt a stroke (§6.4). */
  private async refresh(): Promise<void> {
    if (this.penDown) {
      this.refreshPending = true;
      return;
    }
    if (this.refreshing) {
      this.refreshPending = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        const [{ collections }, problems] = await Promise.all([
          api.collections(),
          api.allProblems(),
        ]);
        const before = new Set(this.state.problems.map((p) => p.id));
        const arrived = problems.filter((p) => !before.has(p.id)).map((p) => p.id);
        const after = new Set(problems.map((p) => p.id));
        const removed = [...before].filter((id) => !after.has(id));
        // Deleted problems: nothing of theirs may be saved again from this device.
        removed.forEach((id) => this.forget(id));
        const newIds = [...new Set([...this.state.newIds, ...arrived])].filter((id) =>
          after.has(id),
        );
        this.remember(problems, newIds);
        // Keep the open problem; if it was deleted (or none was open), open the default one.
        const kept = problems.some((p) => p.id === this.state.currentId);
        const currentId = kept ? this.state.currentId : defaultProblem(problems);
        const opened = currentId !== this.state.currentId;
        this.set((state) => ({
          collections,
          problems,
          newIds,
          currentId,
          details:
            currentId && state.details[currentId] ? { [currentId]: state.details[currentId] } : {},
        }));
        if (opened && currentId) {
          await this.open(currentId);
          return;
        }
        // The last problem was deleted: the old ink must not stay editable with nowhere to save.
        if (opened && !currentId) {
          this.clearCanvas();
          return;
        }
        if (currentId) await this.reconcile(currentId);
      } catch {
        // Offline: the feed reconnects and calls again.
      }
    })().finally(() => {
      this.refreshing = null;
      if (this.refreshPending && !this.penDown) {
        this.refreshPending = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  /** Drop a deleted problem's save queue, cached document, camera and local draft. */
  private forget(id: string) {
    this.syncs.get(id)?.dispose();
    this.syncs.delete(id);
    this.documents.delete(id);
    this.commitKeys.forEach(
      (_key, scope) => scope.startsWith(id + ':') && this.commitKeys.delete(scope),
    );
    if (this.cameras[id]) {
      delete this.cameras[id];
      local.set('cameras', this.cameras);
    }
    void drafts.remove(id);
    void savedCanvases.remove(id);
  }

  /** No problem is open: an empty, locked canvas. A pending load for a deleted problem is cancelled. */
  private clearCanvas() {
    this.showToken++;
    clearTimeout(this.captureTimer);
    this.dirty = false;
    this.engine?.load(null, true);
    local.set('current', null);
    this.set({
      canvas: 'loading',
      hasInk: false,
      fingerprint: null,
      save: { kind: 'saved', at: null },
      ui: CLOSED,
    });
  }

  /** Apply another device's changes to the current problem, unless this device has unsaved work. */
  private async reconcile(id: string) {
    const detail = await api.problem(id);
    if (this.state.currentId !== id) return;
    this.setDetail(detail);
    const sync = this.syncs.get(id);
    if (this.state.marking || !this.engine || this.state.canvas !== 'ready') return;
    const locked = detail.answer_state === 'ready_for_review';
    const moved = sync && detail.canvas_revision !== sync.current.revision;
    const relocked = locked !== this.engine.isLocked;
    if ((moved || relocked) && !this.dirty && !sync?.unsaved) await this.reloadCurrent();
    else if (relocked && locked) this.captureNow(); // The upload reports the conflict.
  }

  private remember(problems: ProblemSummary[], newIds: string[]) {
    local.set(
      'known',
      problems.map((p) => p.id),
    );
    local.set('new', newIds);
  }

  // ---------------------------------------------------------------- overlays

  toggleOverview() {
    if (this.state.ui.overview) return this.closeAll();
    this.ui({
      overview: true,
      qpop: false,
      coll: null,
      set: null,
      batch: null,
      collMenu: false,
      settings: false,
      colors: false,
      fb: false,
    });
  }
  /** The title bar's levels: each opens the Overview at the current problem's level. */
  browse(level: 'collection' | 'set' | 'batch') {
    this.ui({
      overview: true,
      qpop: false,
      coll: null,
      set: null,
      batch: level === 'batch' ? (this.currentSummary()?.type ?? null) : null,
      collMenu: level === 'collection',
      settings: false,
      colors: false,
      fb: false,
    });
  }
  closeAll() {
    this.ui({ overview: false, collMenu: false, settings: false, colors: false });
  }
  toggleCollectionMenu() {
    this.ui({ collMenu: !this.state.ui.collMenu });
  }
  chooseCollection(id: string) {
    this.ui({ coll: id, set: null, batch: null, collMenu: false });
  }
  chooseSet(id: string) {
    const collection = this.state.collections.find((c) => c.sets.some((s) => s.id === id));
    this.ui({ set: id, coll: collection?.id ?? null, batch: null, collMenu: false });
  }
  toggleQuestion() {
    const { qpop } = this.state.ui;
    if (qpop && this.auto.opened) {
      this.auto.opened = false;
      this.auto.declined = true;
    }
    this.ui(qpop ? { qpop: false } : { qpop: true, overview: false, collMenu: false });
  }
  toggleFeedback() {
    this.ui({ fb: !this.state.ui.fb });
  }
  selectFeedback(id: string) {
    this.ui({ fbSel: id });
  }
  toggleSettings() {
    this.ui({ settings: !this.state.ui.settings, colors: false });
  }
  toggleColors() {
    this.ui({ colors: !this.state.ui.colors, settings: false });
  }

  private hint(text: string, rateLimited = false) {
    if (rateLimited && Date.now() - this.hintAt < 4000) return;
    this.hintAt = Date.now();
    const id = ++this.toastId;
    this.set({ hint: { id, text } });
    setTimeout(() => this.state.hint?.id === id && this.set({ hint: null }), 2500);
  }

  private onKey = (event: KeyboardEvent) => {
    if (this.stopped || this.state.phase !== 'ready') return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.altKey && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.redo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { ui } = this.state;
    if (event.key === 'Escape') {
      if (ui.qpop) this.ui({ qpop: false });
      else if (ui.fb) this.ui({ fb: false });
      else this.closeAll();
    } else if (event.key === 'ArrowLeft' && !ui.overview) this.step(-1);
    else if (event.key === 'ArrowRight' && !ui.overview) this.step(1);
    else if (key === 'p' || key === 'e') {
      event.stopPropagation();
      this.setTool(key === 'p' ? 'draw' : 'eraser');
    }
  };
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The first problem of the most recently created set. */
function defaultProblem(problems: ProblemSummary[]) {
  const last = problems.at(-1);
  return last ? inSet(problems, last.set_id)[0].id : null;
}

function summaryOf(detail: ProblemDetail): Partial<ProblemSummary> {
  const {
    body: _b,
    edit_epoch: _e,
    canvas_revision: _r,
    canvas_fingerprint: _f,
    has_content: _h,
    has_unsubmitted_changes: _u,
    snapshots: _s,
    feedback: _fb,
    ...summary
  } = detail;
  return summary;
}

function fromPreferences(values: Preferences): Partial<Prefs> {
  const prefs: Partial<Prefs> = {};
  if (values.hand === 'left' || values.hand === 'right') prefs.hand = values.hand;
  if (typeof values.eraser_sticky === 'boolean') prefs.eraserSticky = values.eraser_sticky;
  if (typeof values.auto_unfold === 'boolean') prefs.autoUnfold = values.auto_unfold;
  if (['black', 'blue', 'red', 'green'].includes(values.color as string))
    prefs.color = values.color as InkColor;
  return prefs;
}
function toPreferences(prefs: Partial<Prefs>): Preferences {
  const values: Preferences = {};
  if (prefs.hand) values.hand = prefs.hand;
  if (prefs.eraserSticky !== undefined) values.eraser_sticky = prefs.eraserSticky;
  if (prefs.autoUnfold !== undefined) values.auto_unfold = prefs.autoUnfold;
  if (prefs.color) values.color = prefs.color;
  return values;
}
