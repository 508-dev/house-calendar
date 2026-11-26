import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateTimeInTimeZoneToIso } from "@/lib/house/date";

type CalendarAdminData =
  | { status: "unavailable"; canDisconnect?: boolean }
  | {
      status: "connected" | "disconnected" | "reconnect";
      sourceLabel: string;
      showViewerNotes: boolean;
      includesCheckoutDay: boolean;
    };

const notices: ReadonlyMap<string, string> = new Map([
  ["connected", "Google Calendar connected."],
  ["disconnected", "Google Calendar disconnected."],
  [
    "manual_revoke",
    "Local access was removed. Remove access in your Google Account to finish revoking the grant.",
  ],
  ["unavailable", "Check the Google Calendar and ICS settings for this house."],
  ["failed", "The Google Calendar request failed. Try again."],
  ["cancelled", "Google Calendar authorization was cancelled."],
  [
    "calendar_access",
    "The Google account could not access the configured calendar as owner.",
  ],
  [
    "consent_required",
    "Google did not grant offline event access. Connect again and allow calendar event access.",
  ],
  [
    "superseded",
    "This connection request was replaced. Open the latest connection request.",
  ],
]);

function localTimeToIso(value: FormDataEntryValue | null, timezone: string) {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute] = parts.map(Number);
  return dateTimeInTimeZoneToIso(
    { year, month, day, hour, minute, second: 0 },
    timezone,
  );
}

export function GoogleCalendarAdmin({
  data,
  siteId,
  timezone,
  notice,
}: {
  data: CalendarAdminData;
  siteId: string;
  timezone: string;
  notice?: string;
}) {
  const [timed, setTimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ eventUrl: string | null }>();
  const lastRequest = useRef<{ body: string; key: string }>(undefined);
  const pending = useRef(false);
  const status =
    data.status === "connected" && needsReconnect ? "reconnect" : data.status;
  const actionUrl = `/admin/${siteId}/google-calendar`;
  const connectionNotice = notice ? notices.get(notice) : undefined;

  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError(undefined);
    setCreated(undefined);

    let range: object;
    if (timed) {
      const startDateTime = localTimeToIso(fields.get("start"), timezone);
      const endDateTime = localTimeToIso(fields.get("end"), timezone);
      if (!startDateTime || !endDateTime) {
        setError(`Enter valid start and end times in ${timezone}.`);
        return;
      }
      range = {
        startDateTime,
        endDateTime,
        showAsViewerNote: fields.get("showAsViewerNote") === "on",
      };
    } else {
      range = {
        startDate: fields.get("start"),
        checkoutDate: fields.get("end"),
      };
    }

    const body = JSON.stringify({
      title: fields.get("title"),
      description: fields.get("description"),
      ...range,
    });
    if (lastRequest.current?.body !== body) {
      lastRequest.current = { body, key: crypto.randomUUID() };
    }

    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/sites/${siteId}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": lastRequest.current.key,
        },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.code === "google_reconnect_required")
          setNeedsReconnect(true);
        setError(
          result.error?.message ??
            "Calendar creation could not be confirmed. Try again.",
        );
        return;
      }
      setCreated({ eventUrl: result.eventUrl });
      form.reset();
      lastRequest.current = undefined;
    } catch {
      setError(
        "Calendar creation could not be confirmed. Submit the same event to retry.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[2rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-6 shadow-[var(--app-shadow)] sm:p-8">
      <h2 className="text-xl font-semibold">Google Calendar</h2>
      {data.status !== "unavailable" && (
        <p className="mt-2 text-sm text-[var(--app-muted)]">
          {data.sourceLabel}
        </p>
      )}
      {connectionNotice && (
        <p role="status" className="mt-3 text-sm">
          {connectionNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--app-danger)]">
          {error}
        </p>
      )}
      {status === "unavailable" && !connectionNotice && (
        <p className="mt-3 text-sm text-[var(--app-muted)]">
          Google Calendar writes are unavailable for this house.
        </p>
      )}
      {status !== "unavailable" && status !== "connected" && (
        <form
          action={`${actionUrl}?action=connect`}
          method="post"
          className="mt-4"
        >
          <Button type="submit">
            {status === "reconnect"
              ? "Reconnect Google Calendar"
              : "Connect Google Calendar"}
          </Button>
        </form>
      )}
      {data.status === "connected" && status === "connected" && (
        <form
          className="mt-5 space-y-4"
          method="post"
          action={`/api/sites/${siteId}/events`}
          onSubmit={submit}
        >
          <fieldset disabled={busy || !ready} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="googleEventTitle">Title</Label>
              <Input
                id="googleEventTitle"
                name="title"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="googleEventDescription">
                Description (optional)
              </Label>
              <Textarea
                id="googleEventDescription"
                name="description"
                maxLength={4000}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={timed}
                onChange={(event) => setTimed(event.target.checked)}
              />
              Timed event
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="googleEventStart">
                  {timed ? "Starts" : "Arrival date"}
                </Label>
                <Input
                  key={`start-${timed}`}
                  id="googleEventStart"
                  name="start"
                  type={timed ? "datetime-local" : "date"}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="googleEventEnd">
                  {timed ? "Ends" : "Checkout date"}
                </Label>
                <Input
                  key={`end-${timed}`}
                  id="googleEventEnd"
                  name="end"
                  type={timed ? "datetime-local" : "date"}
                  required
                />
              </div>
            </div>
            {timed && (
              <p className="text-sm text-[var(--app-muted)]">
                Times are in {timezone}.
              </p>
            )}
            {!timed && data.includesCheckoutDay && (
              <p className="text-sm text-[var(--app-muted)]">
                Google Calendar shows the checkout day. House availability ends
                on the preceding night.
              </p>
            )}
            {timed && data.showViewerNotes && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="showAsViewerNote" />
                Allow viewers to see this timed note
              </label>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create event"}
            </Button>
          </fieldset>
        </form>
      )}
      {created && (
        <p role="status" className="mt-4 text-sm">
          Event created. House availability updates after Google’s ICS feed
          catches up.
          {created.eventUrl && (
            <>
              {" "}
              <a
                href={created.eventUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open in Google Calendar
              </a>
            </>
          )}
        </p>
      )}
      {(status === "connected" ||
        status === "reconnect" ||
        (data.status === "unavailable" && data.canDisconnect)) && (
        <form
          action={`${actionUrl}?action=disconnect`}
          method="post"
          className="mt-5"
        >
          <Button type="submit" variant="outline">
            Disconnect Google Calendar for all houses
          </Button>
        </form>
      )}
    </section>
  );
}
