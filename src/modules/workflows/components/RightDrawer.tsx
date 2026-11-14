import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export function RightDrawer({
  eyebrow,
  title,
  titleId,
  onClose,
  hasUnsavedChanges = false,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  hasUnsavedChanges?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<() => void>(() => undefined);
  function close() {
    if (hasUnsavedChanges && !window.confirm(t("workflow.drawer.unsavedChanges"))) return;
    onClose();
  }
  closeRef.current = close;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return <div className="modal-backdrop right-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="dashboard-panel right-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="panel-heading right-drawer-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label={t("common.close")} onClick={close}><X size={16} /></button></header>
      <div className="right-drawer-content">{children}</div>
    </aside>
  </div>;
}
