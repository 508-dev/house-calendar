import { createFileRoute, notFound } from "@tanstack/react-router";
import { Calendar } from "@/components/calendar";
import { SiteTabs } from "@/components/site-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getViewerPageData } from "@/lib/server/start/page-data";

type ViewerPageData = Exclude<
  Awaited<ReturnType<typeof getViewerPageData>>,
  { kind: "not-found" }
>;

export const Route = createFileRoute("/$siteId")({
  component: SiteHomePage,
  head: ({ loaderData }) => {
    const typedLoaderData = loaderData as ViewerPageData | undefined;
    const metadata = typedLoaderData?.metadata;

    return {
      links: metadata?.icons
        ? [
            { href: metadata.icons.icon, rel: "icon" },
            { href: metadata.icons.shortcut, rel: "shortcut icon" },
            { href: metadata.icons.apple, rel: "apple-touch-icon" },
          ]
        : [],
      meta: metadata
        ? [
            { title: metadata.title },
            { content: metadata.description, name: "description" },
          ]
        : [],
    };
  },
  loader: async ({ params }) => {
    const data = await getViewerPageData({ data: { siteId: params.siteId } });

    if (data.kind === "not-found") {
      throw notFound();
    }

    return data;
  },
  validateSearch: (search: Record<string, unknown>) => ({
    viewerAccessError:
      typeof search.viewerAccessError === "string"
        ? search.viewerAccessError
        : undefined,
  }),
});

function ViewerAccessNotice({
  kind,
  message,
}: {
  kind: "error" | "info";
  message?: string;
}) {
  if (!message) {
    return null;
  }

  const classes =
    kind === "error"
      ? "border-[color:var(--app-danger)]/25 bg-[color:var(--app-danger)]/8 text-[color:var(--app-danger)]"
      : "border-[color:var(--app-accent)]/20 bg-[color:var(--app-accent)]/8 text-[var(--app-accent-strong)]";

  return (
    <p className={`rounded-2xl border px-4 py-3 text-sm ${classes}`}>
      {message}
    </p>
  );
}

function getViewerAccessErrorMessage(
  error: string | undefined,
  configured: boolean,
): string | undefined {
  if (!configured) {
    return "Viewer password protection is enabled, but VIEWER_PASSWORD is not configured.";
  }

  if (error === "misconfigured") {
    return "Viewer password protection is enabled, but VIEWER_PASSWORD is not configured.";
  }

  if (error === "invalid") {
    return "The password is incorrect.";
  }

  return undefined;
}

function SiteHomePage() {
  const data = Route.useLoaderData() as ViewerPageData | undefined;
  const { viewerAccessError } = Route.useSearch();

  if (!data) {
    return null;
  }

  if (data.kind === "locked") {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl space-y-4">
          <Card className="rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] ring-0 sm:p-8">
            <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
              Private viewer access
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
              Enter the house password
            </h1>

            <div className="mt-6 space-y-4">
              <ViewerAccessNotice
                kind="error"
                message={getViewerAccessErrorMessage(
                  viewerAccessError,
                  data.viewerAccess.configured,
                )}
              />
              <ViewerAccessNotice
                kind="info"
                message={
                  data.viewerAccess.configured
                    ? "Enter the shared viewer password to unlock the calendar."
                    : undefined
                }
              />
            </div>

            {data.viewerAccess.configured ? (
              <form
                action={`/${data.site.id}/viewer-access`}
                method="post"
                className="mt-8 space-y-5"
              >
                <div>
                  <Label htmlFor="password" className="mb-2">
                    Viewer password
                  </Label>
                  <Input
                    autoComplete="current-password"
                    className="h-auto rounded-2xl border-[color:var(--app-card-border)] bg-white/90 px-4 py-3 text-base focus-visible:border-[color:var(--app-accent)]"
                    id="password"
                    name="password"
                    required
                    type="password"
                  />
                </div>

                <Button
                  type="submit"
                  className="h-auto rounded-full bg-[var(--app-foreground)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--app-accent-strong)]"
                >
                  Unlock calendar
                </Button>
              </form>
            ) : null}
          </Card>
        </div>
      </main>
    );
  }

  const warningTitle =
    data.source === "sample" ? "Sample data" : "Calendar data notice";
  const warningMessage =
    data.source === "sample"
      ? "This preview is using sample availability until real stay dates are available."
      : "Some calendar data could not be loaded. Availability may be incomplete.";
  const stayRequestsEnabled = false;

  return (
    <main className="min-h-screen px-4 py-5 text-[var(--app-foreground)] sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-[96rem] space-y-4">
        <SiteTabs currentSiteId={data.site.id} sites={data.siteTabs} />

        {data.warnings.length > 0 ? (
          <section
            aria-atomic="true"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="rounded-full bg-amber-100 px-3 py-1 font-semibold">
              {warningTitle}
            </p>
            <p>{warningMessage}</p>
          </section>
        ) : null}

        <Calendar
          days={data.availability}
          houseName={data.house.name}
          requestEnabled={stayRequestsEnabled}
          timedNotes={data.timedNotes}
          timezone={data.house.timezone}
        />
      </div>
    </main>
  );
}
