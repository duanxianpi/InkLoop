import { memo, type ReactNode } from 'react';
import { renderTex, useMathReady } from './math';

// Problem statements and feedback are untrusted Markdown with $…$ / $$…$$ math. Text becomes React
// text nodes (raw HTML shows literally); only MathJax-generated SVG is inserted as markup.

type Token = { math: false; text: string } | { math: true; tex: string; display: boolean };

const MATH =
  /\\\$|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$((?:\\.|[^$\\\n])+?)\$|\\\(([\s\S]+?)\\\)/g;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  let last = 0;
  for (const match of source.matchAll(MATH)) {
    text += source.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[0] === '\\$') {
      text += '$';
      continue;
    }
    if (text) tokens.push({ math: false, text });
    text = '';
    const display = match[1] ?? match[2];
    tokens.push(
      display !== undefined
        ? { math: true, tex: display.trim(), display: true }
        : { math: true, tex: (match[3] ?? match[4]).trim(), display: false },
    );
  }
  text += source.slice(last);
  if (text) tokens.push({ math: false, text });
  return tokens;
}

const INLINE =
  /\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<!\w)_([^_\s][^_\n]*?)_(?!\w)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const plain = (value: string) =>
    value.split('\n').forEach((line, index) => {
      if (index) out.push(<br key={`${key}b${n++}`} />);
      if (line) out.push(line);
    });
  for (const match of text.matchAll(INLINE)) {
    plain(text.slice(last, match.index));
    last = match.index + match[0].length;
    const k = `${key}i${n++}`;
    if (match[1] !== undefined) out.push(<b key={k}>{match[1]}</b>);
    else if (match[2] !== undefined) out.push(<code key={k}>{match[2]}</code>);
    else out.push(<em key={k}>{match[3] ?? match[4]}</em>);
  }
  plain(text.slice(last));
  return out;
}

export function Tex({ tex, display }: { tex: string; display: boolean }) {
  useMathReady();
  const html = renderTex(tex, display);
  if (html === null) return <span className="tex-src">{display ? `$$${tex}$$` : `$${tex}$`}</span>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Paragraphs split on blank lines; single newlines are line breaks. */
export const RichText = memo(function RichText({ text }: { text: string }) {
  const paragraphs: ReactNode[][] = [[]];
  tokenize(text).forEach((token, index) => {
    if (token.math) {
      paragraphs.at(-1)!.push(<Tex key={index} tex={token.tex} display={token.display} />);
      return;
    }
    token.text.split(/\n[ \t]*\n\s*/).forEach((part, chunk) => {
      if (chunk) paragraphs.push([]);
      paragraphs.at(-1)!.push(...inline(part, `${index}.${chunk}`));
    });
  });
  return (
    <div className="md">
      {paragraphs
        .filter((nodes) => nodes.length)
        .map((nodes, index) => (
          <p key={index}>{nodes}</p>
        ))}
    </div>
  );
});
