import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type ToastContextValue = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastContextValue>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const seen = useRef(new Map<string, number>());
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue>((message, tone = "success") => {
    const normalized = message.trim();
    if (!normalized) return;
    const dedupeKey = `${tone}:${normalized}`;
    const now = Date.now();
    if (now - (seen.current.get(dedupeKey) ?? 0) < 1100) return;
    seen.current.set(dedupeKey, now);
    const id = ++nextId.current;
    const duration = tone === "error" ? 8000 : tone === "info" ? 5000 : 3800;
    setToasts((current) => [...current, { id, message: normalized, tone }].slice(-3));
    timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const Icon = (tone: ToastTone) => tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-region" aria-label={t("common.notifications")}>
        {toasts.map((toast) => {
          const ToastIcon = Icon(toast.tone);
          return (
            <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"} aria-live={toast.tone === "error" ? "assertive" : "polite"}>
              <ToastIcon size={18} aria-hidden="true" />
              <span>{toast.message}</span>
              <button type="button" className="toast-dismiss" aria-label={t("common.close")} onClick={() => dismiss(toast.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
