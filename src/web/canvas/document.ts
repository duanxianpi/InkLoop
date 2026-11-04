import type { Editor, TLRecord } from 'tldraw';

// The answer fingerprint (Architecture §6–7): computed in the browser from the answer records of
// the same frozen document that is saved and exported. Camera, selection, tools and question
// presentation are session state and never part of it.

const ANSWER_TYPES = new Set(['shape', 'binding', 'asset']);

function canonical(records: Iterable<TLRecord>): { text: string; count: number } {
  const answer: unknown[] = [];
  let count = 0;
  for (const record of records) {
    if (!ANSWER_TYPES.has(record.typeName)) continue;
    if (record.typeName === 'shape') count++;
    const { id, typeName, ...rest } = record as TLRecord & Record<string, unknown>;
    const { x, y, rotation, index: _index, meta: _meta, ...fields } = rest;
    answer.push([
      id,
      typeName,
      typeof x === 'number' ? Math.round(x * 100) : null,
      typeof y === 'number' ? Math.round(y * 100) : null,
      typeof rotation === 'number' ? Math.round(rotation * 1000) : null,
      fields,
    ]);
  }
  answer.sort((a, b) => ((a as string[])[0] < (b as string[])[0] ? -1 : 1));
  return { text: JSON.stringify(answer), count };
}

/** 53-bit string hash (cyrb53). Synchronous, so a document and its fingerprint are captured together. */
function hash(text: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface CapturedDocument {
  /** The serialized tldraw document (TLStoreSnapshot), exactly as it is uploaded. */
  document: string;
  fingerprint: string;
  has_content: boolean;
}

/** Freeze the editor's current document: one serialization for save, fingerprint and export. */
export function capture(editor: Editor): CapturedDocument {
  const snapshot = editor.store.getStoreSnapshot('document');
  const { text, count } = canonical(Object.values(snapshot.store));
  return {
    document: JSON.stringify(snapshot),
    fingerprint: `${count}:${text.length.toString(36)}:${hash(text, 1)}${hash(text, 2)}`,
    has_content: count > 0,
  };
}

const PADDING = 24;
const MAX_SIDE = 8000;

/** The full drawing (not the viewport) as base64 PNG on white, cropped to the ink with padding. */
export async function exportPng(editor: Editor): Promise<string> {
  const ids = [...editor.getCurrentPageShapeIds()];
  const bounds = editor.getCurrentPageBounds();
  if (!ids.length || !bounds) throw new Error('Nothing to export');
  const longest = Math.max(bounds.w, bounds.h) + 2 * PADDING;
  const pixelRatio = Math.max(0.5, Math.min(2, MAX_SIDE / longest));
  const { blob } = await editor.toImage(ids, {
    format: 'png',
    background: false,
    padding: PADDING,
    scale: 1,
    pixelRatio,
  });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG export failed'))),
      'image/png',
    ),
  );
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(png);
  });
  return url.slice(url.indexOf(',') + 1);
}
