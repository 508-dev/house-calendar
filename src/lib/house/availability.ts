import { addDays, formatISO, isBefore, parseISO } from "date-fns";
import { calendarDateInTimeZone } from "./date";
import { parseEventTitle } from "./parser";
import {
  type DailyAvailability,
  dailyAvailabilitySchema,
  type HouseConfig,
  houseConfigSchema,
  type RawCalendarEvent,
  rawCalendarEventSchema,
} from "./types";

type WorkingDay = Omit<DailyAvailability, "status"> & {
  hasUnknownStay: boolean;
  houseBlockStatus: "free" | "tentative" | "occupied";
  presenceRoomStatusByPerson: Map<string, "free" | "tentative" | "occupied">;
  presenceStatesByPerson: Map<string, "in" | "out" | "unknown">;
  rooms: DailyAvailability["rooms"];
  presence: DailyAvailability["presence"];
};

type InferredDepartureLabel = {
  checkoutDate: string;
  personId: string;
};

function mergeRoomStatus(
  currentStatus: "free" | "tentative" | "occupied",
  nextStatus: "tentative" | "occupied",
): "free" | "tentative" | "occupied" {
  if (currentStatus === "occupied" || nextStatus === "occupied") {
    return "occupied";
  }

  if (currentStatus === "tentative" || nextStatus === "tentative") {
    return "tentative";
  }

  return "free";
}

function asCalendarDate(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);

  if (!match) {
    throw new Error(`Invalid calendar date input: ${value}`);
  }

  return match[0];
}

function enumerateDays(startDate: string, endDateExclusive: string): string[] {
  const days: string[] = [];
  let cursor = parseISO(asCalendarDate(startDate));
  const end = parseISO(asCalendarDate(endDateExclusive));

  while (isBefore(cursor, end)) {
    days.push(formatISO(cursor, { representation: "date" }));
    cursor = addDays(cursor, 1);
  }

  return days;
}

function getPublicPresenceLabel(
  presenceState: "in" | "out" | "unknown",
  presenceStatus: "confirmed" | "tentative",
  occupiesDefaultRoom: boolean,
  eventStartDate: string,
  eventDay: string,
): string | undefined {
  if (presenceState === "out" && eventDay === asCalendarDate(eventStartDate)) {
    return "leaving";
  }

  if (presenceState === "in" && presenceStatus === "tentative") {
    return "tentative";
  }

  if (presenceState === "in" && !occupiesDefaultRoom) {
    return "elsewhere";
  }

  return undefined;
}

function buildSharedSpaceCrashNote(
  eventId: string,
  eventDay: string,
): DailyAvailability["events"][number] {
  return {
    allDay: true,
    endDate: formatISO(addDays(parseISO(eventDay), 1), {
      representation: "date",
    }),
    id: `${eventId}:${eventDay}:shared-space-crash`,
    startDate: eventDay,
    title: "Shared-space crash",
  };
}

export function deriveDailyAvailability(
  configInput: HouseConfig,
  eventsInput: RawCalendarEvent[],
  startDate: string,
  nights: number,
): DailyAvailability[] {
  const config = houseConfigSchema.parse(configInput);
  const events = eventsInput
    .map((event) => rawCalendarEventSchema.parse(event))
    .sort((left, right) => {
      const startDateComparison = left.startDate.localeCompare(right.startDate);

      if (startDateComparison !== 0) {
        return startDateComparison;
      }

      const endDateComparison = left.endDate.localeCompare(right.endDate);

      if (endDateComparison !== 0) {
        return endDateComparison;
      }

      const titleComparison = left.title.localeCompare(right.title);

      if (titleComparison !== 0) {
        return titleComparison;
      }

      return left.id.localeCompare(right.id);
    });

  const endDateExclusive = formatISO(addDays(parseISO(startDate), nights), {
    representation: "date",
  });

  const days: WorkingDay[] = enumerateDays(startDate, endDateExclusive).map(
    (date) => ({
      date,
      events: [],
      hasUnknownStay: false,
      houseBlockStatus: "free" as const,
      rooms: config.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        status: "free" as const,
      })),
      presence: config.people
        .filter((person) => config.visibleHousemateIds.includes(person.id))
        .map((person) => ({
          personId: person.id,
          name: person.name,
          state: "unknown" as const,
        })),
      presenceRoomStatusByPerson: new Map(),
      presenceStatesByPerson: new Map(),
    }),
  );
  const daysByDate = new Map(days.map((day) => [day.date, day] as const));
  const inferredDepartureLabels: InferredDepartureLabel[] = [];

  for (const event of events) {
    if (!event.allDay) {
      if (event.visibility !== "public") {
        continue;
      }

      const eventDay = calendarDateInTimeZone(event.startDate, config.timezone);
      const eventEndDay = calendarDateInTimeZone(
        event.endDate,
        config.timezone,
      );

      if (eventDay !== eventEndDay) {
        continue;
      }

      const day = daysByDate.get(eventDay);

      if (day) {
        day.events.push({
          allDay: false,
          ...(event.description ? { description: event.description } : {}),
          endDate: event.endDate,
          id: event.id,
          startDate: event.startDate,
          title: event.title,
        });
      }

      continue;
    }

    const parsed = parseEventTitle(event.title, config);
    const eventDays = enumerateDays(event.startDate, event.endDate);

    if (
      parsed.type === "presence" &&
      parsed.personId &&
      parsed.presenceState === "in" &&
      parsed.visibility === "public" &&
      parsed.presenceStatus !== "tentative"
    ) {
      inferredDepartureLabels.push({
        checkoutDate: asCalendarDate(event.endDate),
        personId: parsed.personId,
      });
    }

    for (const eventDay of eventDays) {
      const day = daysByDate.get(eventDay);

      if (!day) {
        continue;
      }

      if (parsed.type === "stay") {
        const stayRoomStatus =
          parsed.stayStatus === "tentative" ? "tentative" : "occupied";

        if (parsed.scope === "house") {
          day.rooms = day.rooms.map((room) => ({
            ...room,
            status: mergeRoomStatus(room.status, stayRoomStatus),
          }));
          continue;
        }

        if (parsed.scope === "shared_space") {
          day.houseBlockStatus = mergeRoomStatus(
            day.houseBlockStatus,
            stayRoomStatus,
          );
          day.events.push(buildSharedSpaceCrashNote(event.id, eventDay));
          continue;
        }

        if (parsed.scope === "room" && parsed.roomId) {
          day.rooms = day.rooms.map((room) =>
            room.id === parsed.roomId
              ? {
                  ...room,
                  status: mergeRoomStatus(room.status, stayRoomStatus),
                }
              : room,
          );
          continue;
        }

        day.hasUnknownStay = true;
      }

      if (
        parsed.type === "presence" &&
        parsed.personId &&
        parsed.presenceState
      ) {
        const occupiesDefaultRoom =
          parsed.presenceState === "in" && parsed.occupiesDefaultRoom !== false;

        day.presenceStatesByPerson.set(parsed.personId, parsed.presenceState);
        if (parsed.presenceState !== "in" || !occupiesDefaultRoom) {
          day.presenceRoomStatusByPerson.set(parsed.personId, "free");
        } else {
          const roomStatusForPresence: "tentative" | "occupied" =
            parsed.presenceStatus === "tentative" ? "tentative" : "occupied";

          day.presenceRoomStatusByPerson.set(
            parsed.personId,
            mergeRoomStatus(
              day.presenceRoomStatusByPerson.get(parsed.personId) ?? "free",
              roomStatusForPresence,
            ),
          );
        }
      }

      if (
        parsed.type === "presence" &&
        parsed.personId &&
        parsed.presenceState &&
        parsed.visibility === "public"
      ) {
        const occupiesDefaultRoom =
          parsed.presenceState === "in" && parsed.occupiesDefaultRoom !== false;
        const label = getPublicPresenceLabel(
          parsed.presenceState,
          parsed.presenceStatus ?? "confirmed",
          occupiesDefaultRoom,
          event.startDate,
          eventDay,
        );

        day.presence = day.presence.map((presence) =>
          presence.personId === parsed.personId
            ? {
                ...presence,
                label,
                state: parsed.presenceState ?? "unknown",
              }
            : presence,
        );
      }
    }
  }

  for (const inferredDepartureLabel of inferredDepartureLabels) {
    const day = daysByDate.get(inferredDepartureLabel.checkoutDate);

    if (!day) {
      continue;
    }

    day.presence = day.presence.map((presence) =>
      presence.personId === inferredDepartureLabel.personId &&
      presence.state === "unknown" &&
      !presence.label
        ? {
            ...presence,
            label: "leaving",
          }
        : presence,
    );
  }

  return days.map((day) => {
    const rooms = day.rooms.map((room) => {
      let status = room.status;

      for (const person of config.people) {
        if (person.defaultRoomId !== room.id) {
          continue;
        }

        const presenceRoomStatus =
          day.presenceRoomStatusByPerson.get(person.id) ?? "free";

        if (presenceRoomStatus === "free") {
          continue;
        }

        status = mergeRoomStatus(status, presenceRoomStatus);
      }

      return status === room.status ? room : { ...room, status };
    });
    const occupiedRooms = rooms.filter(
      (room) => room.status === "occupied",
    ).length;
    const tentativeRooms = rooms.filter(
      (room) => room.status === "tentative",
    ).length;
    const status =
      day.houseBlockStatus === "occupied"
        ? "unavailable"
        : day.hasUnknownStay
          ? "unknown"
          : occupiedRooms === day.rooms.length
            ? "unavailable"
            : day.houseBlockStatus === "tentative"
              ? "tentative"
              : occupiedRooms === 0
                ? tentativeRooms === 0
                  ? "available"
                  : "tentative"
                : "partial";

    return dailyAvailabilitySchema.parse({
      ...day,
      houseBlockStatus: undefined,
      rooms,
      status,
    });
  });
}
