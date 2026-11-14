import { ArrowLeft, CircleHelp } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TopBar } from "../components/TopBar";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="public-page">
      <TopBar />
      <main className="not-found-page">
        <span className="not-found-icon"><CircleHelp size={27} /></span>
        <span className="eyebrow">404 · TIMEAX</span>
        <h1>{t("notFound.title")}</h1>
        <p>{t("notFound.lead")}</p>
        <Link className="button button--primary" to="/"><ArrowLeft size={16} />{t("notFound.action")}</Link>
      </main>
    </div>
  );
}
