import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SiteTabs } from "@/components/site-tabs";
import { Button } from "@/components/ui/button";
import { formatDateTimeRangeInTimeZone } from "@/lib/house/date";
import type {
  HouseConfig,
  ParsedCalendarEvent,
  RawCalendarEvent,
} from "@/lib/house/types";
import { getAdminSitePageData } from "@/lib/server/start/page-data";

type AdminSitePageData = Extract<
  Awaited<ReturnType<typeof getAdminSitePageData>>,
  { kind: "ready" }
>;

export const Route = createFileRoute("/admin/$siteId")({
  component: AdminSitePage,
  head: ({ loaderData }) => {
    const typedLoaderData = loaderData as AdminSitePageData | undefined;

    return {
      meta: typedLoaderData
        ? [{ title: typedLoaderData.metadata.title }]
        : [{ title: "Admin" }],
    };
  },
  loader: async ({ params }) => {
    const data = await getAdminSitePageData({
      data: { siteId: params.siteId },
    });

    if (data.kind === "not-found") {
      throw notFound();
    }

    if (data.kind === "redirect") {
      throw redirect({ href: data.target });
    }

    return data;
  },
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
    message: typeof search.message === "string" ? search.message : undefined,
    sync: typeof search.sync === "string" ? search.sync : undefined,
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

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function formatEventRange(
  event: RawCalendarEvent,
  timeZone: string,
): string {
  if (event.allDay) {
    return `${event.startDate} to ${event.endDate}`;
  }

  return formatDateTimeRangeInTimeZone(
    event.startDate,
    event.endDate,
    timeZone,
  );
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function describeInterpretation(
  parsed: ParsedCalendarEvent,
  houseConfig: HouseConfig,
  raw: RawCalendarEvent,
): string {
  if (!raw.allDay) {
    return raw.visibility === "public"
      ? "Timed day event shown on its start date without affecting availability."
      : "Timed day event hidden from viewers because the source event is private or confidential.";
  }

  if (parsed.type === "unknown") {
    return "No deterministic rule matched this title.";
  }

  if (parsed.type === "stay") {
    const guestPrefix = parsed.guestName ? `${parsed.guestName}: ` : "";
    const stayPrefix = parsed.stayStatus === "tentative" ? "Tentative " : "";

    if (parsed.scope === "house") {
      return `${guestPrefix}${stayPrefix}whole-house stay`;
    }

    if (parsed.scope === "room" && parsed.roomId) {
      const room = houseConfig.rooms.find(
        (candidate) => candidate.id === parsed.roomId,
      );

      return `${guestPrefix}${stayPrefix}room stay: ${room?.name ?? parsed.roomId}`;
    }

    return `${guestPrefix}${stayPrefix}stay with unknown scope`;
  }

  const person = parsed.personId
    ? houseConfig.people.find((candidate) => candidate.id === parsed.personId)
    : null;
  const personLabel = person?.name ?? parsed.personId ?? "Unknown person";
  const stateLabel =
    parsed.presenceState === "in"
      ? parsed.presenceStatus === "tentative"
        ? "Tentative in"
        : "In"
      : parsed.presenceState === "out"
        ? "Out"
        : "Unknown";
  const occupancySuffix =
    parsed.presenceState === "in" && parsed.occupiesDefaultRoom === false
      ? " (not staying)"
      : "";

  if (parsed.location) {
    return `${personLabel}: ${stateLabel} (${parsed.location})${occupancySuffix}`;
  }

  return `${personLabel}: ${stateLabel}${occupancySuffix}`;
}

export function buildParsedFieldRows(
  parsed: ParsedCalendarEvent,
  houseConfig: HouseConfig,
  raw: RawCalendarEvent,
): Array<{ label: string; value: string }> {
  if (!raw.allDay) {
    return [
      {
        label: "Viewer calendar",
        value:
          raw.visibility === "public"
            ? "Shown on the viewer calendar"
            : "Hidden from the viewer calendar (private/confidential)",
      },
      {
        label: "Visibility",
        value: raw.visibility,
      },
    ];
  }

  if (parsed.type === "stay") {
    const room = parsed.roomId
      ? houseConfig.rooms.find((candidate) => candidate.id === parsed.roomId)
      : null;
    const housemate = parsed.personId
      ? houseConfig.people.find((candidate) => candidate.id === parsed.personId)
      : null;
    const rows: Array<{ label: string; value: string }> = [];

    if (parsed.guestName) {
      rows.push({ label: "Guest name", value: parsed.guestName });
    }

    if (housemate) {
      rows.push({ label: "Known housemate", value: housemate.name });
    }

    rows.push({
      label: "Stay status",
      value: parsed.stayStatus === "tentative" ? "Tentative" : "Confirmed",
    });

    if (parsed.scope === "house") {
      rows.push({ label: "Scope", value: "Whole house" });
    } else if (parsed.scope === "room" && room) {
      rows.push({ label: "Room", value: room.name });
    } else if (parsed.scope === "room" && parsed.roomId) {
      rows.push({ label: "Room", value: parsed.roomId });
    } else {
      rows.push({ label: "Scope", value: "Unknown" });
    }

    return rows;
  }

  if (parsed.type === "presence") {
    const rows: Array<{ label: string; value: string }> = [];
    const housemate = parsed.personId
      ? houseConfig.people.find((candidate) => candidate.id === parsed.personId)
      : null;

    if (housemate) {
      rows.push({ label: "Known housemate", value: housemate.name });
    } else if (parsed.personId) {
      rows.push({ label: "Known housemate", value: parsed.personId });
    }

    if (parsed.presenceState) {
      rows.push({ label: "Presence state", value: parsed.presenceState });
    }

    if (parsed.presenceState === "in") {
      rows.push({
        label: "Presence status",
        value:
          parsed.presenceStatus === "tentative" ? "Tentative" : "Confirmed",
      });
      rows.push({
        label: "Occupies default room",
        value: parsed.occupiesDefaultRoom === false ? "No" : "Yes",
      });
    }

    if (parsed.location) {
      rows.push({ label: "Location", value: parsed.location });
    }

    return rows;
  }

  return [{ label: "Match", value: "No structured fields captured" }];
}

function AdminSitePage() {
  const data = Route.useLoaderData() as AdminSitePageData | undefined;
  const { error, message } = Route.useSearch();

  if (!data) {
    return null;
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <SiteTabs currentSiteId={data.site.id} sites={data.siteTabs} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] sm:p-8">
            <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
              Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
              {data.site.houseName} control room
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--app-muted)]">
              Password auth is global for this deployment, while sync, parser
              diagnostics, and availability remain scoped to the selected house.
            </p>

            <div className="mt-6 space-y-4">
              <Notice kind="error" message={error} />
              <Notice kind="info" message={message} />
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <AdminStat label="Signed in as" value={data.authEmail} />
              <AdminStat
                label="Selected house"
                value={data.site.houseName}
                detail={`Site ID: ${data.site.id}`}
              />
              <AdminStat
                label="Last ICS sync"
                value={formatTimestamp(data.calendarData.fetchedAt)}
                detail={`${data.calendarData.importedEventCount} imported all-day events`}
              />
              <AdminStat
                label="Cache policy"
                value={`${data.calendarData.cacheTtlMinutes} minute TTL`}
                detail={`Next refresh after ${formatTimestamp(data.calendarData.nextRefreshAt)}`}
              />
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)]">
              <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
                Next up
              </p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-[var(--app-muted)]">
                <li>
                  Current source:{" "}
                  {data.calendarData.source === "ics"
                    ? "Live ICS import"
                    : "Sample fallback"}
                </li>
                <li>Warnings: {data.calendarData.warnings.length}</li>
                <li>Unknown parses: {data.unknownInterpretationCount}</li>
                <li>Share-link management</li>
                <li>Request triage and approval</li>
              </ul>

              <form
                action={`/admin/${data.site.id}/sync`}
                method="post"
                className="mt-6"
              >
                <Button
                  type="submit"
                  className="h-auto rounded-full bg-[var(--app-foreground)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--app-accent-strong)]"
                >
                  Sync ICS now
                </Button>
              </form>

              <form action="/admin/logout" method="post" className="mt-6">
                <Button
                  type="submit"
                  variant="outline"
                  className="h-auto rounded-full border-[color:var(--app-card-border)] bg-white/75 px-4 py-2 text-sm font-semibold"
                >
                  Sign out
                </Button>
              </form>
            </section>
          </aside>
        </div>

        <section className="rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] sm:p-8">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
            Imported events
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
            ICS parser diagnostics
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--app-muted)]">
            This list shows the raw imported event titles and how the parser is
            interpreting them right now. Timed events can also appear here when
            they are shown as same-day viewer notes.
          </p>

          <div className="mt-8 space-y-3">
            {data.interpretationRows.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-[color:var(--app-card-border)] bg-white/40 px-5 py-6 text-sm text-[var(--app-muted)]">
                No imported events are available yet.
              </div>
            ) : (
              <div className="max-h-[48rem] space-y-3 overflow-y-auto pr-1">
                {data.interpretationRows.map(({ parsed, raw }) => {
                  const parsedFieldRows = buildParsedFieldRows(
                    parsed,
                    data.houseConfig,
                    raw,
                  );

                  return (
                    <article
                      key={raw.id}
                      className="rounded-[1.5rem] border border-[color:var(--app-card-border)] bg-white/60 p-5"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold break-words">
                            {raw.title}
                          </p>
                          <p className="mt-1 text-sm text-[var(--app-muted)]">
                            {formatEventRange(raw, data.houseConfig.timezone)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {[
                            raw.allDay ? "all-day" : "timed",
                            parsed.type,
                            parsed.scope,
                            parsed.visibility,
                            formatConfidence(parsed.confidence),
                          ].map((label) => (
                            <span
                              key={label}
                              className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-700"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-[color:var(--app-card-border)] bg-white/55 px-4 py-3">
                          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--app-muted)]">
                            Interpretation
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--app-foreground)]">
                            {describeInterpretation(
                              parsed,
                              data.houseConfig,
                              raw,
                            )}
                          </p>
                          <p className="mt-2 text-sm text-[var(--app-muted)]">
                            Normalized title: {parsed.normalizedTitle}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-[color:var(--app-card-border)] bg-white/55 px-4 py-3">
                          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--app-muted)]">
                            Parsed fields
                          </p>
                          <dl className="mt-2 grid gap-2 text-sm">
                            {parsedFieldRows.map((row) => (
                              <div
                                key={row.label}
                                className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)]"
                              >
                                <dt className="text-[var(--app-muted)]">
                                  {row.label}
                                </dt>
                                <dd className="font-medium text-[var(--app-foreground)]">
                                  {row.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function AdminStat({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-[color:var(--app-card-border)] bg-white/60 p-5">
      <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.24em] text-[var(--app-muted)]">
        {label}
      </p>
      <p className="mt-3 text-lg font-semibold">{value}</p>
      {detail ? (
        <p className="mt-1 text-sm text-[var(--app-muted)]">{detail}</p>
      ) : null}
    </div>
  );
}
