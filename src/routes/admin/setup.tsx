import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdminSetupPageData } from "@/lib/server/start/page-data";

export const Route = createFileRoute("/admin/setup")({
  component: AdminSetupPage,
  head: () => ({
    meta: [{ title: "Admin setup" }],
  }),
  loader: async () => {
    const data = await getAdminSetupPageData();

    if (data.kind === "redirect") {
      throw redirect({ href: data.target });
    }

    return data;
  },
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});

function ErrorBanner({
  children,
  message,
}: {
  children?: ReactNode;
  message?: string;
}) {
  const content = children ?? message;

  if (!content) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex gap-3 rounded-2xl border border-[color:var(--app-danger)]/40 bg-[color:var(--app-danger)]/12 px-4 py-3 text-sm leading-6 text-[color:var(--app-danger)] shadow-[0_10px_24px_rgba(122,52,39,0.08)]"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--app-danger)] text-xs font-bold text-white"
      >
        !
      </span>
      <div className="min-w-0 font-medium">{content}</div>
    </div>
  );
}

function AdminSetupPage() {
  const data = Route.useLoaderData();
  const { error } = Route.useSearch();

  const canSetup =
    data.authState.databaseConfigured && data.authState.bootstrapCodeReady;

  return (
    <main className="flex min-h-screen items-center px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-lg">
        <Card className="rounded-lg border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] ring-0 sm:p-8">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
            Admin setup
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Create admin account</h1>

          <div className="mt-6 space-y-4">
            <ErrorBanner message={error} />

            {!data.authState.databaseConfigured ? (
              <ErrorBanner message="DATABASE_URL is required before admin setup can run." />
            ) : null}

            {!data.authState.bootstrapCodeReady ? (
              <ErrorBanner>
                <p>Generate a setup code first.</p>
                <code className="mt-2 block w-fit rounded-lg bg-white/80 px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-[color:var(--app-danger)]">
                  bun run admin:bootstrap-code
                </code>
              </ErrorBanner>
            ) : null}
          </div>

          {canSetup ? (
            <form
              action="/admin/setup/submit"
              method="post"
              className="mt-8 space-y-5"
            >
              <div>
                <Label htmlFor="bootstrapCode" className="mb-2">
                  Bootstrap code
                </Label>
                <Input
                  className="h-auto rounded-2xl border-[color:var(--app-card-border)] bg-white/90 px-4 py-3 text-base focus-visible:border-[color:var(--app-accent)]"
                  id="bootstrapCode"
                  name="bootstrapCode"
                  required
                  type="password"
                />
              </div>

              <div>
                <Label htmlFor="email" className="mb-2">
                  Admin email
                </Label>
                <Input
                  autoComplete="email"
                  className="h-auto rounded-2xl border-[color:var(--app-card-border)] bg-white/90 px-4 py-3 text-base focus-visible:border-[color:var(--app-accent)]"
                  id="email"
                  name="email"
                  required
                  type="email"
                />
              </div>

              <div>
                <Label htmlFor="password" className="mb-2">
                  Admin password
                </Label>
                <Input
                  autoComplete="new-password"
                  className="h-auto rounded-2xl border-[color:var(--app-card-border)] bg-white/90 px-4 py-3 text-base focus-visible:border-[color:var(--app-accent)]"
                  id="password"
                  minLength={10}
                  name="password"
                  required
                  type="password"
                />
              </div>

              <Button
                type="submit"
                className="h-auto rounded-full bg-[var(--app-foreground)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--app-accent-strong)]"
              >
                Create admin account
              </Button>
            </form>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
