import type { ProblemDetail, ProblemSummary } from '../../shared/model';
import type { BoardController, BoardState } from './controller';
import { Chevron, GridIcon } from './icons';
import { RichText } from './RichText';
import { inSet, numberOf } from './view';

type Props = {
  s: BoardState;
  c: BoardController;
  problem: ProblemSummary;
  detail: ProblemDetail | undefined;
};

/**
 * Sticky Peek (§5.2): overview · collection / set / batch · question · previous and next. Each
 * level opens the overview at that level; the question unfolds its statement.
 */
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
        <nav className="qttl" aria-label="Where this problem is">
          <button
            className="lv up coll"
            title={problem.collection_title}
            aria-label={`Collection ${problem.collection_title}: choose another collection`}
            onClick={() => c.browse('collection')}
          >
            {problem.collection_title}
          </button>
          <span className="sl up">/</span>
          <button
            className="lv up set"
            title={problem.set_title}
            aria-label={`Set ${problem.set_title}: show its problems`}
            onClick={() => c.browse('set')}
          >
            {problem.set_title}
          </button>
          {problem.type && (
            <>
              <span className="sl">/</span>
              <button
                className="lv batch"
                title={problem.type}
                aria-label={`Batch ${problem.type}: show it in the overview`}
                onClick={() => c.browse('batch')}
              >
                {problem.type}
              </button>
            </>
          )}
          <button
            className="lv qt"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} question ${number}: ${problem.title}`}
            onClick={() => c.toggleQuestion()}
          >
            Q{number} · {problem.title}
          </button>
        </nav>
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
      {/* Always mounted, so the statement can slide open and closed. */}
      <div className="qwrap" inert={!open} aria-hidden={!open}>
        <div className="qb">
          <div className="qbody">{detail && <RichText text={detail.body} />}</div>
        </div>
      </div>
      <button
        className="grip"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => c.toggleQuestion()}
      />
    </div>
  );
}
