import type { ProblemDetail } from '../../shared/model';
import type { BoardController, BoardState } from './controller';
import { hhmm } from './view';

/** Answer state and save state, bottom corner on the tool-rail side (§13.2). */
export function StatusLine({
  s,
  c,
  detail,
}: {
  s: BoardState;
  c: BoardController;
  detail?: ProblemDetail;
}) {
  const side = s.narrow ? 'left' : s.prefs.hand === 'right' ? 'left' : 'right';
  const latest = detail?.snapshots.at(-1);
  const save = saveText(s);
  const saved = save && <span className={`sv ${save.tone}`}>({save.text})</span>;
  let answer = null;
  if (s.canvas === 'ready' && detail && latest) {
    answer =
      detail.answer_state === 'ready_for_review' ? (
        <span className="si ready">
          Ready for review · snapshot {latest.sequence} {saved}
        </span>
      ) : (
        <span className="si edit">
          Editing · {s.fingerprint !== latest.fingerprint ? 'changed since' : 'same as'} snapshot{' '}
          {latest.sequence} {saved}
        </span>
      );
  }
  const conflict = s.save.kind === 'conflict';
  return (
    <div className={`status ${side}`} id="status" aria-live="polite">
      {answer ?? saved}
      {conflict && (
        <span>
          {s.save.kind === 'conflict' && s.save.code !== 'canvas_locked' && (
            <button className="sact" onClick={() => void c.keepLocal()}>
              Keep this device's version
            </button>
          )}{' '}
          <button className="sact" onClick={() => void c.discardLocal()}>
            Load saved version
          </button>
        </span>
      )}
    </div>
  );
}

function saveText(s: BoardState): { text: string; tone: string } | null {
  if (s.canvas !== 'ready') return null;
  switch (s.save.kind) {
    case 'saved':
      return s.save.at ? { text: 'Saved ' + hhmm(s.save.at), tone: '' } : null;
    case 'pending':
    case 'saving':
      return { text: 'Saving…', tone: 'pending' };
    case 'offline':
      return { text: 'Connection unavailable · kept on this device', tone: 'warn' };
    case 'failed':
      return { text: 'Save failed · retrying', tone: 'bad' };
    case 'conflict':
      return {
        text:
          s.save.code === 'canvas_locked'
            ? 'Marked ready elsewhere · your changes are kept on this device'
            : 'Changed on another device · your changes are kept on this device',
        tone: 'bad',
      };
  }
}
