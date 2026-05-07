import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdminLoginPageData } from "@/lib/server/start/page-data";

export const Route = createFileRoute("/admin/login")({
  beforeLoad: async () => {
    const data = await getAdminLoginPageData();

    if (data.kind === "redirect") {
      throw redirect({ href: data.target });
    }
  },
  component: AdminLoginPage,
  head: () => ({
    meta: [{ title: "Admin login" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
    message: typeof search.message === "string" ? search.message : undefined,
  }),
});

function Notice({
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

function AdminLoginPage() {
  const { error, message } = Route.useSearch();

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <Card className="mx-auto max-w-xl rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] ring-0 sm:p-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
          Admin login
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
          Sign in to manage the house
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--app-muted)]">
          This deployment uses a single owner account stored in Postgres. Email
          delivery is not required for normal local or production login.
        </p>

        <div className="mt-6 space-y-4">
          <Notice kind="error" message={error} />
          <Notice kind="info" message={message} />
        </div>

        <form
          action="/admin/login/submit"
          method="post"
          className="mt-8 space-y-5"
        >
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
              Password
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

          <div className="flex items-center justify-between gap-4">
            <Button
              type="submit"
              className="h-auto rounded-full bg-[var(--app-foreground)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--app-accent-strong)]"
            >
              Sign in
            </Button>

            <a
              href="/admin/setup"
              className="text-sm font-medium text-[var(--app-muted)] underline-offset-4 hover:underline"
            >
              Setup page
            </a>
          </div>
        </form>
      </Card>
    </main>
  );
}
