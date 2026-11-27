import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { shouldTurnRoutePage } from "./route-page-turn";

export function RoutePageTurn({ hostedAuthPanels = false }: { hostedAuthPanels?: boolean }) {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  const sequence = useRef(0);
  const [turn, setTurn] = useState(0);

  useLayoutEffect(() => {
    const play = shouldTurnRoutePage(previousPath.current, pathname, hostedAuthPanels);
    previousPath.current = pathname;
    if (!play || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTurn(0);
      return;
    }
    setTurn(++sequence.current);
  }, [pathname, hostedAuthPanels]);

  // Only the decorative leaf moves: the new page is already mounted and usable.
  // No snapshots, route remounts, focus changes or transition delay.
  return turn ? <span key={turn} className="route-page-turn" aria-hidden="true"
    onAnimationEnd={() => setTurn(current => current === turn ? 0 : current)}><span className="route-page-turn-leaf" /></span> : null;
}
