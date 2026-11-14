import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandMark } from "./BrandMark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({ landing = false }: { landing?: boolean }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="topbar-wrap">
      <div className="topbar">
        <BrandMark />
        <nav className="desktop-nav" aria-label={t("nav.product")}>
          {landing ? (
            <>
              <a href="#features">{t("nav.product")}</a>
              <a href="#how-it-works">{t("nav.howItWorks")}</a>
              <Link to="/support">{t("common.support")}</Link>
            </>
          ) : (
            <NavLink to="/" end>{t("common.backHome")}</NavLink>
          )}
        </nav>
        <div className="topbar-actions">
          <LanguageSwitcher compact />
          <ThemeToggle />
          <Link className="button button--small button--quiet desktop-login" to="/login">
            {t("common.login")} <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <button className="icon-button mobile-menu-toggle" type="button" aria-label={menuOpen ? t("common.closeMenu") : t("common.menu")} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="mobile-nav" aria-label={t("nav.product")}>
          {landing && <a href="#features" onClick={closeMenu}>{t("nav.product")}</a>}
          {landing && <a href="#how-it-works" onClick={closeMenu}>{t("nav.howItWorks")}</a>}
          <Link to="/support" onClick={closeMenu}>{t("common.support")}</Link>
          <Link to="/login" onClick={closeMenu}>{t("common.login")}</Link>
        </nav>
      )}
    </header>
  );
}
