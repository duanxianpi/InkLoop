import type { ProblemDetail, ProblemSummary } from '../../shared/model';
import type { BoardController, BoardState } from './controller';
import { Chevron, GridIcon } from './icons';
import { RichText } from './RichText';
import { inSet, numberOf, shortSet } from './view';

type Props = {
  s: BoardState;
  c: BoardController;
  problem: ProblemSummary;
  detail: ProblemDetail | undefined;
};

/** Sticky Peek (§5.2): overview · set / question · previous and next; the title unfolds the question. */
export function QuestionBar({ s, c, problem, detail }: Props) {
  const list = inSet(s.problems, problem.set_id);
  const index = list.indexOf(problem);
  const number = numberOf(s.problems, problem);
  const open = s.ui.qpop;
  return (
    <div className={`qbar float${open ? ' open' : ''}`} id="qbar">
      <div className="qrow" ref={(element) => c.registerQuestionRow(element)}>
        <button
          className="ib ovb"
          aria-label="All problems"
          aria-expanded={s.ui.overview}
          onClick={() => c.toggleOverview()}
        >
          <GridIcon />
        </button>
        <span className="vsep" />
        <button
          className="qttl"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} question ${number}: ${problem.title}`}
          onClick={() => c.toggleQuestion()}
        >
          <span className="wk">{s.narrow ? shortSet(problem.set_title) : problem.set_title}</span>
          <span className="sl">/</span>
          <span className="qt">
            Q{number} · {problem.title}
          </span>
        </button>
        <span className="vsep" />
        <button
          className="ib"
          aria-label="Previous problem"
          disabled={index <= 0}
          onClick={() => c.step(-1)}
        >
          <Chevron dir="left" />
        </button>
        <button
          className="ib"
          aria-label="Next problem"
          disabled={index >= list.length - 1}
          onClick={() => c.step(1)}
        >
          <Chevron dir="right" />
        </button>
      </div>
      {open && (
        <div className="qb">
          <div className="qbody">{detail && <RichText text={detail.body} />}</div>
        </div>
      )}
      <button
        className="grip"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => c.toggleQuestion()}
      />
    </div>
  );
}
