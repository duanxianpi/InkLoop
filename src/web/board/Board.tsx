import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import './board.css';
import type { ProblemDetail, ProblemSummary } from '../../shared/model';
import { canvasAssetUrls } from '../canvas/assets';
import { CopyRow, mcpUrl } from '../design/Copy';
import { Engine } from '../canvas/engine';
import { BoardController, type BoardState } from './controller';
import { loadMath } from './math';
import { Overview } from './Overview';
import { usePresence } from './presence';
import { QuestionBar } from './QuestionBar';
import { Rail } from './Rail';
import { FeedbackCard, TopRight } from './Review';
import { RichText } from './RichText';
import { StatusLine } from './StatusLine';
import { useStore } from './store';
import { numberOf } from './view';

// The product page (Specification Part II): Board + Sticky Peek. The canvas fills the viewport;
// the printed question tile moves with it underneath; the chrome floats above.

const OPTIONS = { edgeScrollSpeed: 0, edgeScrollDistance: 0, maxPages: 1 };

export function Board() {
  const [controller] = useState(() => new BoardController());
  useEffect(() => {
    document.documentElement.classList.add('board-page');
    void loadMath();
    void controller.start();
    return () => {
      controller.stop();
      document.documentElement.classList.remove('board-page');
    };
  }, [controller]);
  const s = useStore(controller.store);
  const current = s.problems.find((problem) => problem.id === s.currentId);
  const detail = current && s.details[current.id];

  return (
    <div className={`app${s.narrow ? ' narrow' : ''}`}>
      <World c={controller} problem={current} detail={detail} problems={s.problems} />
      <Canvas c={controller} />
      <div className="chrome">
        {current ? (
          <Chrome s={s} c={controller} current={current} detail={detail} />
        ) : (
          <Notice s={s} c={controller} />
        )}
      </div>
    </div>
  );
}

/** tldraw is mounted once and never re-rendered by the board; documents are swapped inside it. */
const Canvas = memo(function Canvas({ c }: { c: BoardController }) {
  return (
    <div id="engine">
      <Tldraw
        hideUi
        assetUrls={canvasAssetUrls}
        options={OPTIONS}
        inferDarkMode={false}
        onMount={(editor) => {
          const engine = new Engine(editor, c.events, {
            penMode: c.state.prefs.penMode,
            color: c.state.prefs.color,
          });
          c.attachEngine(engine);
          return () => {
            c.detachEngine();
            engine.dispose();
          };
        }}
      />
    </div>
  );
});

/** The dotted board and the printed question tile, transformed with the camera. */
function World({
  c,
  problem,
  detail,
  problems,
}: {
  c: BoardController;
  problem?: ProblemSummary;
  detail?: ProblemDetail;
  problems: ProblemSummary[];
}) {
  const under = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    c.registerWorld(world.current, paper.current, under.current);
    return () => c.registerWorld(null, null, null);
  }, [c]);
  return (
    <div className="under" ref={under}>
      <div className="world" ref={world}>
        <div className="paper" ref={paper}>
          {problem && (
            <QuestionTile
              c={c}
              problem={problem}
              detail={detail}
              number={numberOf(problems, problem)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionTile({
  c,
  problem,
  detail,
  number,
}: {
  c: BoardController;
  problem: ProblemSummary;
  detail?: ProblemDetail;
  number: number;
}) {
  const tile = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = tile.current!;
    c.registerTile(element);
    c.tileResized(element.offsetHeight);
    const observer = new ResizeObserver(() => c.tileResized(element.offsetHeight));
    observer.observe(element);
    return () => {
      observer.disconnect();
      c.registerTile(null);
    };
  }, [c]);
  return (
    <div className="qtile" id="qtile" ref={tile}>
      <div className="qmeta">
        {problem.type && (
          <>
            <span>{problem.type}</span>
            <i />
          </>
        )}
        <span>Q{number}</span>
        <i />
        <span className="tt">{problem.title}</span>
      </div>
      <div className="qbody">{detail?.id === problem.id && <RichText text={detail.body} />}</div>
    </div>
  );
}

function Chrome({
  s,
  c,
  current,
  detail,
}: {
  s: BoardState;
  c: BoardController;
  current: ProblemSummary;
  detail?: ProblemDetail;
}) {
  const locked = detail?.answer_state === 'ready_for_review' || s.marking || s.canvas !== 'ready';
  const sheet = usePresence(s.ui.overview);
  return (
    <>
      <Rail s={s} c={c} locked={locked} />
      <StatusLine s={s} c={c} detail={detail} />
      <div className="toprow">
        <QuestionBar s={s} c={c} problem={current} detail={detail} />
        <TopRight s={s} c={c} detail={detail} />
      </div>
      <FeedbackCard s={s} c={c} detail={detail} />
      {s.canvas === 'unavailable' && (
        <div className="notice float" role="alert">
          <h2>This canvas can't be loaded right now</h2>
          <p>It isn't stored on this device yet. Check the connection and try again.</p>
          <button className="pbtn" onClick={() => c.retryCanvas()}>
            Try again
          </button>
        </div>
      )}
      {s.ui.overview && <div className="scrim clear" onClick={() => c.closeAll()} />}
      {sheet.mounted && (
        <div className="sheet" role="dialog" aria-label="All problems" data-state={sheet.state}>
          <Overview s={s} c={c} current={current} />
        </div>
      )}
      {(s.ui.settings || s.ui.colors) && (
        <div className="scrim clear" onClick={() => c.closeAll()} />
      )}
      {s.hint && (
        <div key={s.hint.id} className="hint" role="status">
          {s.hint.text}
        </div>
      )}
    </>
  );
}

/** Before the first problem exists, or when the board cannot load. */
function Notice({ s, c }: { s: BoardState; c: BoardController }) {
  if (s.phase === 'loading') return null;
  return (
    <div className="notice float" role={s.phase === 'error' ? 'alert' : 'status'}>
      {s.phase === 'error' ? (
        <>
          <h2>InkLoop couldn't load your problems</h2>
          <p>Check the connection and try again.</p>
          <button className="pbtn" onClick={() => c.retry()}>
            Try again
          </button>
        </>
      ) : (
        <>
          <h2>No problems yet</h2>
          <p>
            Add this MCP server to your AI app, then ask it to create problems. They appear here
            automatically.
          </p>
          <CopyRow text={mcpUrl()} />
          <a className="pbtn" href="/settings/connected-apps">
            Connected AI apps
          </a>
        </>
      )}
    </div>
  );
}
