import { useT } from "@/i18n/useT";

export function Footer() {
  const t = useT();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line bg-surface px-4 pt-4 pb-24 text-[13px] lg:pb-4 text-ink-muted lg:px-7">
      <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
        <nav aria-label="Legal" className="flex items-center gap-4">
          <span className="cursor-default hover:text-primary">{t("footer.privacy")}</span>
          <span className="cursor-default hover:text-primary">{t("footer.terms")}</span>
        </nav>
        <p className="flex items-center gap-1.5 text-center">
          © {year} AI-powered IP Stakeholder’s BRIDGETECH
        </p>
      </div>
    </footer>
  );
}
