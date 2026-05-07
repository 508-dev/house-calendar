import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    defaultNotFoundComponent: NotFoundPage,
    routeTree,
    scrollRestoration: true,
  });
}

function NotFoundPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] sm:p-8">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
          Not found
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
          This page is not available
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--app-muted)]">
          The house or admin page you requested does not exist in this
          deployment.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex rounded-full bg-[var(--app-foreground)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--app-accent-strong)]"
        >
          Go to the default house
        </a>
      </section>
    </main>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
