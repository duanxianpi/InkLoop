import type { CalloutKind, ProblemDetail } from '../../shared/model';
import type { BoardController, BoardState } from './controller';
import { Chevron, FeedbackIcon, PenIcon, ReadyIcon } from './icons';
import { usePresence } from './presence';
import { RichText, Tex } from './RichText';
import { hhmm, shownFeedback, snapshotOf, VERDICT, verdictClass } from './view';

type Props = { s: BoardState; c: BoardController; detail: ProblemDetail | undefined };

/** Review control and Mark ready / Resume editing, top right (§7.1, §9). */
export function TopRight({ s, c, detail }: Props) {
  const shown = detail && shownFeedback(detail, s.ui.fbSel);
  const verdict = shown?.verdict ? VERDICT[shown.verdict] : null;
  const earlier = shown && shown.snapshot_id !== detail!.snapshots.at(-1)?.id;
  const ready = detail?.answer_state === 'ready_for_review';
  return (
    <div className="topright">
      {shown && (
        <button
          className={`fbb ${verdictClass(shown, detail!)}`}
          aria-expanded={s.ui.fb}
          aria-label={`Feedback${verdict ? ': ' + verdict[1] : ''}${earlier ? ', on an earlier snapshot' : ''}`}
          onClick={() => c.toggleFeedback()}
        >
          <FeedbackIcon />
          {verdict && <span>{verdict[0]}</span>}
        </button>
      )}
      {ready ? (
        <button className="fin" disabled={s.canvas !== 'ready'} onClick={() => void c.resume()}>
          <PenIcon size={13.5} />
          Resume editing
        </button>
      ) : (
        <button
          className="fin go"
          disabled={!detail || !s.hasInk || s.marking || s.canvas !== 'ready'}
          aria-busy={s.marking}
          onClick={() => void c.markReady()}
        >
          <ReadyIcon />
          Mark ready
        </button>
      )}
    </div>
  );
}

const CALLOUT_CLASS: Record<CalloutKind, string> = { correct: 'ok', fix: 'fix', incorrect: 'bad' };

/** The expanded review card under the top-right controls (§7.2–7.4). */
export function FeedbackCard({ s, c, detail }: Props) {
  const shown = detail && shownFeedback(detail, s.ui.fbSel);
  const card = usePresence(s.ui.fb && !!shown);
  if (!detail || !shown || !card.mounted) return null;
  const verdict = shown.verdict ? VERDICT[shown.verdict] : null;
  const snapshot = snapshotOf(detail, shown.snapshot_id)!;
  const latest = detail.snapshots.at(-1)!;
  const earlier = snapshot.id !== latest.id;
  const changed = detail.answer_state === 'working' && s.fingerprint !== latest.fingerprint;
  const note = earlier
    ? `This feedback is on snapshot ${snapshot.sequence}. ${
        detail.feedback.some((entry) => entry.snapshot_id === latest.id)
          ? ''
          : `Snapshot ${latest.sequence} (${hhmm(latest.created_at)}) has no feedback yet.`
      }`
    : changed
      ? `You've changed the board since snapshot ${snapshot.sequence}. Mark ready again to send the new version.`
      : '';
  const style =
    !s.narrow && s.prefs.hand === 'left' ? { right: 'calc(63px + var(--sar))' } : undefined;
  return (
    <div
      className={`fb ${verdictClass(shown, detail)}`}
      id="fb"
      role="region"
      aria-label="Feedback"
      style={style}
      data-state={card.state}
    >
      <div className="fbhead">
        {verdict ? (
          <>
            <b>{verdict[0]}</b>
            <span className="fl">{verdict[1]}</span>
          </>
        ) : (
          <span className="fl">Feedback</span>
        )}
        <button className="ib" aria-label="Close feedback" onClick={() => c.toggleFeedback()}>
          <Chevron dir="up" />
        </button>
      </div>
      <div className="fbbody">
        {note && <div className="fbnote">{note}</div>}
        <RichText text={shown.text} />
        {shown.callouts.map((callout, index) => (
          <div key={index} className={`co ${CALLOUT_CLASS[callout.kind]}`}>
            {callout.math && (
              <div className="cq">
                <Tex tex={callout.math} display />
              </div>
            )}
            <div className="cn">
              <RichText text={callout.text} />
            </div>
          </div>
        ))}
        <div className="fbfoot">
          <span>
            Snapshot {snapshot.sequence} taken {hhmm(snapshot.created_at)}
          </span>
          <span>Reviewed {hhmm(shown.created_at)}</span>
        </div>
        {detail.feedback.length > 1 && (
          <div className="fbhist">
            <h4>All feedback</h4>
            {[...detail.feedback].reverse().map((entry) => {
              const entryVerdict = entry.verdict ? VERDICT[entry.verdict] : ['·', 'Comment'];
              return (
                <button
                  key={entry.id}
                  aria-pressed={entry.id === shown.id}
                  onClick={() => c.selectFeedback(entry.id)}
                >
                  <span className={`hs v-${entry.verdict ?? 'none'}`}>{entryVerdict[0]}</span>
                  <span>Snapshot {snapshotOf(detail, entry.snapshot_id)?.sequence}</span>
                  <span className="hm">
                    {entryVerdict[1]} · reviewed {hhmm(entry.created_at)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
