import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type SiteTabsProps = {
  currentSiteId: string;
  sites: Array<{
    href: string;
    id: string;
    label: string;
  }>;
};

export function SiteTabs({ currentSiteId, sites }: SiteTabsProps) {
  if (sites.length < 2) {
    return null;
  }

  return (
    <nav aria-label="House switcher" className="flex justify-center">
      <div className="grid w-full grid-cols-2 gap-2 rounded-full border border-[color:var(--app-card-border)] bg-[color:var(--app-card)]/90 p-2 shadow-[var(--app-shadow)] sm:w-auto sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
        {sites.map((site) => {
          const isCurrent = site.id === currentSiteId;

          return (
            <Link
              key={site.id}
              to={site.href}
              aria-current={isCurrent ? "page" : undefined}
              style={{
                color: isCurrent ? "white" : "var(--app-muted)",
              }}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2.5 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] sm:min-w-[10.5rem]",
                isCurrent
                  ? "bg-[color:var(--app-foreground)] shadow-[0_10px_24px_rgba(29,22,12,0.16)]"
                  : "bg-white/72 hover:bg-white",
              )}
            >
              {site.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
