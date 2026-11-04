import { useSyncExternalStore } from 'react';

// MathJax loads once, in the background; until then math shows as its TeX source. Rendered markup
// is cached per expression, so unchanged formulas are never typeset twice (§19.2).

type Render = (tex: string, display: boolean) => string;
let render: Render | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, string>();

export function loadMath() {
  loading ??= import('./mathjax')
    .then((module) => {
      render = module.render;
      listeners.forEach((listener) => listener());
    })
    .catch(() => {
      loading = null; // Retried by the next render.
    });
  return loading;
}

/** SVG markup for `tex`, or null while MathJax is loading. */
export function renderTex(tex: string, display: boolean): string | null {
  if (!render) {
    void loadMath();
    return null;
  }
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = render(tex, display);
    cache.set(key, html);
  }
  return html;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Re-renders the caller once MathJax is available. */
const ready = () => render !== null;
export const useMathReady = () => useSyncExternalStore(subscribe, ready, ready);
