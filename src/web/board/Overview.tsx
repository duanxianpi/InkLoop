import type { ProblemSummary } from '../../shared/model';
import type { BoardController, BoardState } from './controller';
import { Chevron } from './icons';
import { inSet, numberOf, TILE_CLASS, TILE_LABEL, trendBadge } from './view';

const LEGEND = [
  ['empty', 'Not started'],
  ['progress', 'In progress'],
  ['ready', 'Ready for review'],
  ['correct', 'Correct'],
  ['partial', 'Partial'],
  ['incorrect', 'Incorrect'],
] as const;

/** Problem Overview (§6.3): collection menu, set chips, categories and numbered status tiles. */
export function Overview({
  s,
  c,
  current,
}: {
  s: BoardState;
  c: BoardController;
  current: ProblemSummary;
}) {
  const collection =
    s.collections.find((entry) => entry.id === s.ui.coll) ??
    s.collections.find((entry) => entry.id === current.collection_id) ??
    s.collections[0];
  if (!collection) return null;
  const setIds = collection.sets.map((set) => set.id);
  const setId = setIds.includes(s.ui.set ?? '')
    ? s.ui.set!
    : setIds.includes(current.set_id)
      ? current.set_id
      : setIds.at(-1);
  const problems = setId ? inSet(s.problems, setId) : [];
  const types = [...new Set(problems.map((problem) => problem.type ?? 'Problems'))];
  const isNew = (problem: ProblemSummary) => s.newIds.includes(problem.id);

  const tile = (problem: ProblemSummary) => {
    const number = numberOf(s.problems, problem);
    const badge = trendBadge(problem.trend);
    return (
      <button
        key={problem.id}
        className={`t ${TILE_CLASS[problem.tile]}${problem.id === current.id ? ' cur' : ''}`}
        title={problem.title}
        aria-label={`Problem ${number}, ${TILE_LABEL[problem.tile]}${badge?.label ? ', ' + badge.label : ''}${isNew(problem) ? ', new' : ''}`}
        onClick={() => c.go(problem.id)}
      >
        {number}
        {badge && (
          <span className={`vb${/[↗↘]/.test(badge.symbol) ? ' arrow' : ''}`}>{badge.symbol}</span>
        )}
        {isNew(problem) && <span className="nd" />}
      </button>
    );
  };

  return (
    <>
      <div className="shead">
        <button
          className="coll"
          aria-expanded={s.ui.collMenu}
          onClick={() => c.toggleCollectionMenu()}
        >
          <span>{collection.title}</span>
          <Chevron dir="down" />
        </button>
        <button className="ib" aria-label="Close" onClick={() => c.closeAll()}>
          <Chevron dir="x" />
        </button>
        {s.ui.collMenu && (
          <div className="collmenu" role="menu">
            {s.collections.map((entry) => (
              <button
                key={entry.id}
                role="menuitemradio"
                aria-checked={entry.id === collection.id}
                aria-pressed={entry.id === collection.id}
                onClick={() => c.chooseCollection(entry.id)}
              >
                <span>{entry.title}</span>
                {s.problems.some(
                  (problem) => problem.collection_id === entry.id && isNew(problem),
                ) && <span className="cdot" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {collection.sets.length > 1 && (
        <div className="weeks">
          {collection.sets.map((set) => (
            <button
              key={set.id}
              className="week"
              aria-pressed={set.id === setId}
              onClick={() => c.chooseSet(set.id)}
            >
              {set.title}
            </button>
          ))}
        </div>
      )}
      <div className="ovscroll">
        {types.map((type) => (
          <div key={type} className="sec">
            <h4>{type}</h4>
            <div className="tiles">
              {problems.filter((problem) => (problem.type ?? 'Problems') === type).map(tile)}
            </div>
          </div>
        ))}
      </div>
      <div className="legend">
        {LEGEND.map(([key, label]) => (
          <span key={key}>
            <i className={`sw ${key}`} />
            {label}
          </span>
        ))}
        <span className="lgb">↗ better than the last reviewed snapshot</span>
        <span className="lgb">↘ worse</span>
      </div>
    </>
  );
}
