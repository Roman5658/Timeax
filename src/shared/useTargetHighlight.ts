import { useEffect } from "react";

export function useTargetHighlight(targetId: string, active = true) {
  useEffect(() => {
    if (!active || !targetId) return;
    let observer: MutationObserver | undefined;
    let highlightTimer: number | undefined;
    let stopped = false;
    let didFocus = false;

    const focusTarget = () => {
      if (stopped || didFocus) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      didFocus = true;
      observer?.disconnect();

      let details = target.closest("details");
      while (details) {
        details.open = true;
        details = details.parentElement?.closest("details") ?? null;
      }

      window.requestAnimationFrame(() => {
        if (stopped || !target.isConnected) return;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.remove("target-highlight");
        void target.offsetWidth;
        target.classList.add("target-highlight");
        highlightTimer = window.setTimeout(() => target.classList.remove("target-highlight"), 3400);
      });
    };

    focusTarget();
    observer = new MutationObserver(focusTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    const stopObserving = window.setTimeout(() => observer?.disconnect(), 4000);

    return () => {
      stopped = true;
      observer?.disconnect();
      window.clearTimeout(stopObserving);
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
      document.getElementById(targetId)?.classList.remove("target-highlight");
    };
  }, [targetId, active]);
}
