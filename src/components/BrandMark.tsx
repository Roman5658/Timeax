import logo from "./timeax-brand.webp";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link className={`brand-mark${compact ? " brand-mark--compact" : ""}`} to="/" aria-label={t("home.brandLabel")}>
      <img className="brand-mark-image" src={logo} width={600} height={200} alt="" draggable={false} />
    </Link>
  );
}
