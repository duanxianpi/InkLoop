import { useEffect, useState } from 'react';

/** Must match the pop-out animation in board.css. */
const EXIT_MS = 140;

/**
 * Keeps a popup mounted while it animates out. Render it while `mounted`, with
 * `data-state={state}`: board.css animates it in on mount and out once the state is 'closed'.
 */
export function usePresence(open: boolean) {
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return { mounted: open || leaving, state: open ? 'open' : 'closed' } as const;
}
