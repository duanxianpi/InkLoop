import { DefaultColorStyle, DefaultSizeStyle, type Editor, type TLStoreSnapshot } from 'tldraw';
import { capture, exportPng } from './document';

// The thin adapter over the pinned tldraw editor. One editor shows one Problem's document at a
// time; switching Problems loads that Problem's document. Everything product-specific (saving,
// locking rules, navigation) lives in the board controller, not here.

export type InkColor = 'black' | 'blue' | 'red' | 'green';
export const INK: Record<InkColor, string> = {
  black: '#1d1d1d',
  blue: '#4465e9',
  red: '#e03131',
  green: '#099268',
};
export type Tool = 'draw' | 'eraser';
/** Screen-space camera: the world layer is translated by (x, y) and scaled by z. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface EngineEvents {
  /** The user changed the document (never fired for loads). */
  onDocumentChange(): void;
  onCamera(camera: Camera): void;
  onHistory(canUndo: boolean, canRedo: boolean): void;
  /** The engine switched tools by itself (the eraser returning to the pen). */
  onTool(tool: Tool): void;
  onPenMode(): void;
}

const EXTERNAL_CONTENT = [
  'embed',
  'excalidraw',
  'file-replace',
  'files',
  'svg-text',
  'text',
  'tldraw',
  'url',
] as const;

export class Engine {
  private readonly blank: TLStoreSnapshot;
  private locked = false;
  private color: InkColor;
  private tool: Tool = 'draw';
  eraserSticky = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly editor: Editor,
    private events: EngineEvents,
    options: { penMode: boolean; color: InkColor },
  ) {
    this.blank = editor.store.getStoreSnapshot('document');
    editor.user.updateUserPreferences({ colorScheme: 'light', edgeScrollSpeed: 0 });
    editor.updateInstanceState({ isGridMode: false, isPenMode: options.penMode });
    this.color = options.color;
    this.applyStyles();
    editor.setCurrentTool('draw');
    // Only handwriting: pasted or dropped content (images, video, embeds, links) is ignored, so a
    // stored document never makes the browser fetch third-party content.
    for (const type of EXTERNAL_CONTENT) editor.registerExternalContentHandler(type, null);

    this.cleanup.push(
      editor.store.listen(() => this.reportCamera(), { scope: 'session' }),
      editor.store.listen(() => events.onDocumentChange(), { source: 'user', scope: 'document' }),
      editor.store.listen(() => this.reportHistory()),
      editor.store.listen(
        () => {
          if (editor.getInstanceState().isPenMode) events.onPenMode();
        },
        { scope: 'session' },
      ),
    );
    const onEvent = (info: { type: string; name: string }) => {
      if (
        info.type === 'pointer' &&
        info.name === 'pointer_up' &&
        editor.getCurrentToolId() === 'eraser' &&
        !this.eraserSticky
      )
        setTimeout(() => {
          if (this.locked || this.tool !== 'eraser') return;
          this.setTool('draw');
          events.onTool('draw');
        }, 0);
    };
    editor.on('event', onEvent);
    this.cleanup.push(() => editor.off('event', onEvent));
    setTimeout(() => {
      this.reportCamera();
      this.reportHistory();
    }, 0);
  }

  dispose() {
    this.cleanup.forEach((stop) => stop());
  }

  /** Replace the document (null: an empty one). Undo history starts fresh for each Problem. */
  load(document: string | null, locked: boolean) {
    const snapshot = document ? (JSON.parse(document) as TLStoreSnapshot) : this.blank;
    this.editor.store.mergeRemoteChanges(() => this.editor.loadSnapshot({ document: snapshot }));
    this.editor.clearHistory();
    // Loading a document resets the next-stroke styles to tldraw's defaults.
    this.applyStyles();
    this.setLocked(locked);
  }

  capture() {
    return capture(this.editor);
  }
  exportPng() {
    return exportPng(this.editor);
  }
  count() {
    return this.editor.getCurrentPageShapeIds().size;
  }

  /** Ready for Review: strokes stay visible, pan and zoom stay available, nothing can change. */
  setLocked(locked: boolean) {
    this.locked = locked;
    this.editor.updateInstanceState({ isReadonly: locked });
    this.editor.setCurrentTool(locked ? 'hand' : this.tool);
    this.reportHistory();
  }
  get isLocked() {
    return this.locked;
  }

  setTool(tool: Tool) {
    this.tool = tool;
    if (!this.locked) this.editor.setCurrentTool(tool);
  }
  setColor(color: InkColor) {
    this.color = color;
    this.editor.setStyleForNextShapes(DefaultColorStyle, color);
  }
  undo() {
    if (!this.locked) this.editor.undo();
  }
  redo() {
    if (!this.locked) this.editor.redo();
  }

  getCamera(): Camera {
    const { x, y, z } = this.editor.getCamera();
    return { x: x * z, y: y * z, z };
  }
  setCamera(camera: Camera, animate = false) {
    this.editor.setCamera(
      { x: camera.x / camera.z, y: camera.y / camera.z, z: camera.z },
      animate ? { animation: { duration: 260 } } : undefined,
    );
  }
  get container() {
    return this.editor.getContainer();
  }

  private applyStyles() {
    this.editor.setStyleForNextShapes(DefaultSizeStyle, 's');
    this.editor.setStyleForNextShapes(DefaultColorStyle, this.color);
  }

  private reportCamera() {
    this.events.onCamera(this.getCamera());
  }
  private reportHistory() {
    this.events.onHistory(
      !this.locked && this.editor.getCanUndo(),
      !this.locked && this.editor.getCanRedo(),
    );
  }
}
