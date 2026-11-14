import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../../shared/formatters";
import { RightDrawer } from "./RightDrawer";
import type { WorkerHistoryMonth } from "../worker-history";
import { formatDuration } from "../workflow-utils";

export function WorkerHistoryMonthPicker({
  months,
  selectedMonth,
  onSelect,
  openOnMobile = true,
}: {
  months: WorkerHistoryMonth[];
  selectedMonth?: string;
  onSelect: (month: string) => void;
  openOnMobile?: boolean;
}) {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const initialMobileOpen = useRef(false);
  const selected = months.find((month) => month.key === selectedMonth);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 650px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!openOnMobile) {
      initialMobileOpen.current = true;
      return;
    }
    if (isMobile && months.length && !initialMobileOpen.current) {
      initialMobileOpen.current = true;
      setDrawerOpen(true);
    }
  }, [isMobile, months.length, openOnMobile]);

  function selectMonth(month: string) {
    onSelect(month);
    setDrawerOpen(false);
  }

  const monthButtons = months.map((month) => {
    const date = new Date(`${month.key}-01T12:00:00`);
    const active = month.key === selectedMonth;
    return <button
      type="button"
      className={`worker-history-month-button${active ? " is-active" : ""}`}
      key={month.key}
      aria-current={active ? "date" : undefined}
      onClick={() => selectMonth(month.key)}
    >
      <span className="worker-history-month-label">{formatDate(date, { month: "long", year: "numeric" })}</span>
      <span className="worker-history-month-summary">
        {t("workflow.worker.historyMonthSummary", {
          shifts: month.workedShiftCount,
          hours: formatDuration(month.paidMinutes, t),
          missed: month.missedDayCount,
          daysOff: month.restDayCount,
        })}
      </span>
    </button>;
  });

  return <>
    <aside className="dashboard-panel worker-history-month-picker" aria-label={t("workflow.worker.monthsTitle")}>
      <div className="panel-heading"><div><span className="eyebrow">{t("nav.shifts")}</span><h2>{t("workflow.worker.monthsTitle")}</h2></div></div>
      {monthButtons.length ? <div className="worker-history-month-list">{monthButtons}</div> : <p className="muted-copy">{t("workflow.worker.historyEmpty")}</p>}
    </aside>

    <div className="worker-history-mobile-months">
      <button className="button button--outline worker-history-mobile-month-button" type="button" onClick={() => setDrawerOpen(true)}>
        <CalendarDays size={16} />
        <span>{selected ? formatDate(new Date(`${selected.key}-01T12:00:00`), { month: "long", year: "numeric" }) : t("workflow.worker.monthsTitle")}</span>
        <span>{t("workflow.worker.openMonths")}</span>
      </button>
    </div>

    {isMobile && drawerOpen && <RightDrawer
      eyebrow={t("nav.shifts")}
      title={t("workflow.worker.monthsTitle")}
      titleId="worker-history-months-title"
      onClose={() => setDrawerOpen(false)}
    >
      {monthButtons.length ? <div className="worker-history-month-list">{monthButtons}</div> : <p className="muted-copy">{t("workflow.worker.historyEmpty")}</p>}
    </RightDrawer>}
  </>;
}
