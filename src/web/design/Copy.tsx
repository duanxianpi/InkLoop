import { useState } from 'react';

// Copy a value to the clipboard, with a selectable fallback when the clipboard is unavailable.

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}
    </button>
  );
}

export function CopyRow({ text }: { text: string }) {
  return (
    <div className="copy-row">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

export const mcpUrl = () => location.origin + '/mcp';
export const BRAND_ICON = '/assets/brand/inkloop-v2.svg';
