import { INK, type InkColor } from '../canvas/engine';
import { CopyButton, mcpUrl } from '../design/Copy';
import { forgetOfflineData } from '../pwa';
import type { BoardController, BoardState } from './controller';
import { EraserIcon, PenIcon, RedoIcon, SettingsIcon, UndoIcon } from './icons';

type Props = { s: BoardState; c: BoardController; locked: boolean };

/** Writing tools on the edge away from the writing hand; horizontal at the bottom on narrow screens. */
export function Rail({ s, c, locked }: Props) {
  const side = s.narrow ? 'h' : s.prefs.hand === 'right' ? 'left' : 'right';
  return (
    <div
      className={`rail ${side} float${s.ui.settings || s.ui.colors ? ' withpop' : ''}`}
      role="toolbar"
      aria-label="Writing tools"
    >
      <button
        className="ib"
        aria-pressed={!locked && s.tool === 'draw'}
        aria-label="Pen"
        disabled={locked}
        onClick={() => c.setTool('draw')}
      >
        <PenIcon />
      </button>
      <button
        className="ib"
        aria-pressed={!locked && s.tool === 'eraser'}
        aria-label="Eraser"
        disabled={locked}
        onClick={() => c.setTool('eraser')}
      >
        <EraserIcon />
      </button>
      <button
        className="ib colb"
        aria-label={`Pen colour: ${s.prefs.color}`}
        aria-expanded={s.ui.colors}
        disabled={locked}
        onClick={() => c.toggleColors()}
      >
        <i style={{ background: INK[s.prefs.color] }} />
      </button>
      <span className="sep" />
      <button
        className="ib"
        aria-label="Undo"
        disabled={!s.canUndo || locked}
        onClick={() => c.undo()}
      >
        <UndoIcon />
      </button>
      <button
        className="ib"
        aria-label="Redo"
        disabled={!s.canRedo || locked}
        onClick={() => c.redo()}
      >
        <RedoIcon />
      </button>
      <span className="sep" />
      <button
        className="ib set"
        aria-label="Settings"
        aria-expanded={s.ui.settings}
        onClick={() => c.toggleSettings()}
      >
        <SettingsIcon />
      </button>
      {s.ui.settings && <Settings s={s} c={c} />}
      {s.ui.colors && (
        <div className="cpop" role="menu" aria-label="Pen colour">
          {(Object.keys(INK) as InkColor[]).map((color) => (
            <button
              key={color}
              aria-pressed={s.prefs.color === color}
              aria-label={color}
              onClick={() => c.setColor(color)}
            >
              <i style={{ background: INK[color] }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick(): void }) {
  return (
    <button className="tog" aria-pressed={on} onClick={onClick}>
      <span>{label}</span>
      <i />
    </button>
  );
}

function Settings({ s, c }: { s: BoardState; c: BoardController }) {
  const signOut = async () => {
    await fetch('/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    await forgetOfflineData().catch(() => undefined);
    location.assign('/login');
  };
  return (
    <div className="pop" id="settings" role="dialog" aria-label="Settings">
      <div className="grp">
        <h3>Writing</h3>
        <Toggle
          on={s.prefs.hand === 'left'}
          label="Left-handed"
          onClick={() => c.setPrefs({ hand: s.prefs.hand === 'left' ? 'right' : 'left' })}
        />
        <Toggle
          on={s.prefs.eraserSticky}
          label="Eraser stays on after use"
          onClick={() => c.setPrefs({ eraserSticky: !s.prefs.eraserSticky })}
        />
        <Toggle
          on={s.prefs.autoUnfold}
          label="Unfold the question when it scrolls out of view"
          onClick={() => c.setPrefs({ autoUnfold: !s.prefs.autoUnfold })}
        />
        <div className="cap">Two-finger tap undoes, three-finger tap redoes.</div>
      </div>
      <div className="grp">
        <h3>Account</h3>
        <div className="prows">
          <CopyButton className="prow" text={mcpUrl()} label="Copy MCP server URL" />
          <a className="prow" href="/settings/connected-apps">
            Connected AI apps
          </a>
          <a className="prow" href="/settings/password">
            Change password
          </a>
          <button className="prow" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
