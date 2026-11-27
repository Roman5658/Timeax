import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function RightDrawer({
  eyebrow,
  title,
  titleId,
  onClose,
  hasUnsavedChanges = false,
  busy = false,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  busy?: boolean;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  function finishClose() {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true); closeTimer.current = window.setTimeout(onClose, 180);
  }
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const [confirmClose, setConfirmClose] = useState(false);
  const resumeFocusRef = useRef<HTMLElement | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = confirmClose;
    if (confirmClose) continueRef.current?.focus();
    else if (resumeFocusRef.current?.isConnected) resumeFocusRef.current.focus();
  }, [confirmClose]);
  const closeRef = useRef<() => void>(() => undefined);
  function close() {
    if (busy) return;
    if (confirmClose) { setConfirmClose(false); return; }
    if (hasUnsavedChanges) { resumeFocusRef.current = document.activeElement as HTMLElement | null; setConfirmClose(true); return; }
    finishClose();
  }
  closeRef.current = close;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const underlyingDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((item) => item !== dialog);
    const previousInert = underlyingDialogs.map((item) => item.inert);
    underlyingDialogs.forEach((item) => { item.inert = true; });
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter((item) => item.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") { event.stopPropagation(); closeRef.current(); }
      if (event.key === "Tab") {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      underlyingDialogs.forEach((item, index) => { item.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(<div className={`modal-backdrop right-drawer-backdrop${closing ? " is-closing" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside ref={dialogRef} tabIndex={-1} className="dashboard-panel right-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="panel-heading right-drawer-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label={t("common.close")} disabled={busy} onClick={close}><X size={16} /></button></header>
      <div className="right-drawer-content">
        {confirmClose && <section className="notice-box" aria-label={t("workflow.drawer.unsavedChanges")}>
          <p>{t("workflow.drawer.unsavedChanges")}</p><div className="form-actions">
            <button ref={continueRef} className="button button--primary" type="button" onClick={() => setConfirmClose(false)}>{t("workflow.drawer.continueEditing")}</button>
            <button className="button button--outline" type="button" onClick={finishClose}>{t("workflow.drawer.discardAndClose")}</button>
          </div>
        </section>}
        <div ref={contentRef} hidden={confirmClose}>{typeof children === "function" ? children(close) : children}</div>
      </div>
    </aside>
  </div>, document.body);
}
