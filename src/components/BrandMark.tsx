import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link className={`brand-mark${compact ? " brand-mark--compact" : ""}`} to="/" aria-label={t("home.brandLabel")}>
      <img className="brand-mark-image" src="/timeax-logo.png" alt="" draggable={false} />
    </Link>
  );
}
