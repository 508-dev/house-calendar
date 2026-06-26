import {
  type HouseConfig,
  houseConfigSchema,
  type ParsedCalendarEvent,
} from "./types";

const STAY_RE = /\bstay\b/;
const MAYBE_STAY_RE = /\bmaybe stay\b/;
const MAYBE_RE = /\bmaybe\b/;
const OUT_RE = /\b(out|away)\b/;
const IN_RE = /\bin\b/;
const WHOLE_HOUSE_RE = /\b(whole house|house)\b/;
const SHARED_SPACE_RE = /\b(couch|sofa|floor)\b/;
const NOT_STAYING_SUFFIX_RE =
  /^(.*?)(?:\s*,\s*not staying|\s*\(\s*not staying\s*\))$/i;
const TENTATIVE_HINT_RE = /^(tentative|maybe)$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\[([^\]]+)\]/g, "($1)")
    .toLowerCase();
}

export function normalizeTitle(title: string): string {
  return canonicalizeTitle(title)
    .replace(/\bstays\b/gi, "stay")
    .replace(/\bcrash(?:es|ing)?\b/gi, "stay");
}

function extractBracketHint(normalizedTitle: string): string | undefined {
  const match = normalizedTitle.match(/\(([^)]+)\)/);
  return match?.[1]?.trim();
}

function extractBracketHints(normalizedTitle: string): string[] {
  return (
    extractBracketHint(normalizedTitle)
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  );
}

function isTentativeHint(value: string): boolean {
  return TENTATIVE_HINT_RE.test(value.trim());
}

function isNotStayingHint(value: string): boolean {
  return value.trim().toLowerCase() === "not staying";
}

function roomHintKeys(value: string): string[] {
  const normalizedValue = normalizeTitle(value);
  const compactValue = normalizedValue.replace(/[^a-z0-9]+/g, "");
  const keys = new Set([normalizedValue, compactValue]);
  const withoutRoomSuffix = normalizedValue.replace(/\s+room$/i, "").trim();

  if (
    withoutRoomSuffix !== normalizedValue &&
    withoutRoomSuffix.length >= 4 &&
    !SHARED_SPACE_RE.test(withoutRoomSuffix)
  ) {
    keys.add(withoutRoomSuffix);
    keys.add(withoutRoomSuffix.replace(/[^a-z0-9]+/g, ""));
  }

  return [...keys].filter(Boolean);
}

function roomMatchesHint(
  room: HouseConfig["rooms"][number],
  hintKeys: Set<string>,
): boolean {
  return [room.name, ...room.aliases]
    .flatMap(roomHintKeys)
    .some((key) => hintKeys.has(key));
}

function inferStayStatus(normalizedTitle: string): "confirmed" | "tentative" {
  return MAYBE_STAY_RE.test(normalizedTitle) ||
    extractBracketHints(normalizedTitle).some(isTentativeHint)
    ? "tentative"
    : "confirmed";
}

function inferPresenceStatus(
  normalizedTitle: string,
): "confirmed" | "tentative" {
  return MAYBE_RE.test(normalizedTitle) ||
    extractBracketHints(normalizedTitle).some(isTentativeHint)
    ? "tentative"
    : "confirmed";
}

function stripTentativeMarkers(title: string): string {
  if (OUT_RE.test(title)) {
    return title.trim().replace(/\s+/g, " ");
  }

  return title
    .replace(/\bmaybe\s+(stay|stays|in)\b/gi, "$1")
    .replace(/\(([^)]+)\)/g, (_match, content: string) => {
      const filtered = content
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => !isTentativeHint(value));

      return filtered.length > 0 ? `(${filtered.join(", ")})` : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function stripNotStayingMarker(title: string): string {
  return title.replace(NOT_STAYING_SUFFIX_RE, "$1").replace(/\s+/g, " ").trim();
}

function extractGuestName(
  rawTitle: string,
  normalizedTitle: string,
  personId?: string,
): string | undefined {
  if (personId || !STAY_RE.test(normalizedTitle)) {
    return undefined;
  }

  const match = rawTitle.match(
    /^\s*(.+?)\s+(?:(?:is|are)\s+)?(?:maybe\s+)?(?:stays?|crash(?:es|ing)?)\b/i,
  );
  const guestName = match?.[1]?.trim();

  return guestName ? guestName : undefined;
}

function findPersonId(
  normalizedTitle: string,
  config: HouseConfig,
): string | undefined {
  for (const person of config.people) {
    const candidates = [person.name, ...person.aliases].map((value) =>
      normalizeTitle(value),
    );

    if (
      candidates.some((candidate) =>
        normalizedTitle.match(
          new RegExp(`^${escapeRegExp(candidate)}\\b`, "i"),
        ),
      )
    ) {
      return person.id;
    }
  }

  return undefined;
}

function getTemplatedPresenceVisibility(
  personId: string,
  config: HouseConfig,
): "public" | "private" {
  const person = config.people.find((candidate) => candidate.id === personId);

  if (
    person?.publicVisibility === "visible" &&
    config.visibleHousemateIds.includes(personId)
  ) {
    return "public";
  }

  return "private";
}

function parsePresenceLocationDetails(rawLocation: string | undefined): {
  location: string | undefined;
  occupiesDefaultRoom?: boolean;
  presenceStatus?: "confirmed" | "tentative";
} {
  const trimmedLocation = rawLocation?.trim();

  if (!trimmedLocation) {
    return {
      location: undefined,
    };
  }

  const rawParts = trimmedLocation
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const presenceStatus = rawParts.some(isTentativeHint)
    ? "tentative"
    : undefined;
  const cleanedLocation = rawParts
    .filter((value) => !isTentativeHint(value))
    .join(", ");

  if (!cleanedLocation) {
    return {
      location: undefined,
      presenceStatus,
    };
  }

  if (isNotStayingHint(cleanedLocation)) {
    return {
      location: undefined,
      occupiesDefaultRoom: false,
      presenceStatus,
    };
  }

  const notStayingMatch = cleanedLocation.match(NOT_STAYING_SUFFIX_RE);

  if (!notStayingMatch) {
    return {
      location: cleanedLocation,
      presenceStatus,
    };
  }

  const location = notStayingMatch[1]?.trim();

  return {
    location: location ? location : undefined,
    occupiesDefaultRoom: false,
    presenceStatus,
  };
}

function matchTemplatedPresenceRule(
  normalizedTitle: string,
  config: HouseConfig,
): Omit<ParsedCalendarEvent, "rawTitle"> | undefined {
  for (const person of config.people) {
    const candidates = [person.name, ...person.aliases].map((value) =>
      normalizeTitle(value),
    );

    for (const candidate of candidates) {
      const escapedCandidate = escapeRegExp(candidate);
      const visibility = getTemplatedPresenceVisibility(person.id, config);
      const outMatch = normalizedTitle.match(
        new RegExp(`^${escapedCandidate} out of japan(?: \\((.+)\\))?$`, "i"),
      );

      if (outMatch && inferPresenceStatus(normalizedTitle) === "confirmed") {
        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: person.id,
          presenceState: "out",
          location: outMatch[1]?.trim(),
          visibility,
          confidence: 0.98,
        };
      }

      const bracketOutMatch = normalizedTitle.match(
        new RegExp(`^${escapedCandidate} out \\((.+)\\)$`, "i"),
      );

      if (
        bracketOutMatch &&
        inferPresenceStatus(normalizedTitle) === "confirmed"
      ) {
        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: person.id,
          presenceState: "out",
          location: bracketOutMatch[1]?.trim(),
          visibility,
          confidence: 0.98,
        };
      }

      const bracketInMatch = normalizedTitle.match(
        new RegExp(`^${escapedCandidate} \\((.+)\\)$`, "i"),
      );

      if (bracketInMatch) {
        const { location, occupiesDefaultRoom, presenceStatus } =
          parsePresenceLocationDetails(bracketInMatch[1]);

        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: person.id,
          presenceState: "in",
          location,
          occupiesDefaultRoom,
          presenceStatus:
            presenceStatus ?? inferPresenceStatus(normalizedTitle),
          visibility,
          confidence: 0.98,
        };
      }

      const textInMatch = normalizedTitle.match(
        new RegExp(`^${escapedCandidate} (maybe\\s+)?in (.+)$`, "i"),
      );

      if (textInMatch) {
        const { location, occupiesDefaultRoom, presenceStatus } =
          parsePresenceLocationDetails(textInMatch[2]);

        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: person.id,
          presenceState: "in",
          location,
          occupiesDefaultRoom,
          presenceStatus:
            textInMatch[1] ||
            presenceStatus === "tentative" ||
            inferPresenceStatus(normalizedTitle) === "tentative"
              ? "tentative"
              : "confirmed",
          visibility,
          confidence: 0.98,
        };
      }
    }
  }

  return undefined;
}

function matchExplicitRule(
  candidateTitles: string[],
  normalizedTitle: string,
  config: HouseConfig,
): Omit<ParsedCalendarEvent, "rawTitle"> | undefined {
  for (const rule of config.rules) {
    const regex = new RegExp(rule.match, "i");
    const match = candidateTitles
      .map((title) => title.match(regex))
      .find((candidateMatch) => candidateMatch);

    if (!match) {
      continue;
    }

    switch (rule.type) {
      case "stay.whole_house":
        return {
          normalizedTitle,
          type: "stay",
          scope: "house",
          visibility: rule.visibility,
          confidence: 0.99,
        };
      case "stay.room":
        return {
          normalizedTitle,
          type: "stay",
          scope: "room",
          roomId: rule.roomId,
          visibility: rule.visibility,
          confidence: 0.97,
        };
      case "stay.shared_space":
        return {
          normalizedTitle,
          type: "stay",
          scope: "shared_space",
          visibility: rule.visibility,
          confidence: 0.97,
        };
      case "presence.in": {
        const explicitNotStaying =
          stripNotStayingMarker(normalizedTitle) !== normalizedTitle;
        const { location, occupiesDefaultRoom, presenceStatus } =
          parsePresenceLocationDetails(match[1]?.trim());

        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: rule.actorId,
          presenceState: "in",
          location,
          occupiesDefaultRoom:
            occupiesDefaultRoom ?? (explicitNotStaying ? false : undefined),
          presenceStatus:
            presenceStatus ?? inferPresenceStatus(normalizedTitle),
          visibility: rule.visibility,
          confidence: 0.95,
        };
      }
      case "presence.out":
        if (inferPresenceStatus(normalizedTitle) === "tentative") {
          continue;
        }

        return {
          normalizedTitle,
          type: "presence",
          scope: "location",
          personId: rule.actorId,
          presenceState: "out",
          location: match[1]?.trim(),
          visibility: rule.visibility,
          confidence: 0.95,
        };
    }
  }

  return undefined;
}

function fallbackStayParse(
  rawTitle: string,
  normalizedTitle: string,
  config: HouseConfig,
  personId?: string,
): ParsedCalendarEvent | undefined {
  if (!STAY_RE.test(normalizedTitle)) {
    return undefined;
  }

  const hintParts = extractBracketHints(normalizedTitle);
  const stayStatus = inferStayStatus(normalizedTitle);
  const scopeHint = hintParts.find((hint) => !isTentativeHint(hint));

  if (scopeHint && WHOLE_HOUSE_RE.test(scopeHint)) {
    return {
      rawTitle,
      normalizedTitle,
      type: "stay",
      scope: "house",
      personId,
      guestName: extractGuestName(rawTitle, normalizedTitle, personId),
      stayStatus,
      visibility: "private",
      confidence: personId ? 0.93 : 0.75,
    };
  }

  const roomHintKeySet = new Set(hintParts.flatMap(roomHintKeys));
  const room = config.rooms.find((candidate) =>
    roomMatchesHint(candidate, roomHintKeySet),
  );

  if (room) {
    return {
      rawTitle,
      normalizedTitle,
      type: "stay",
      scope: "room",
      personId,
      guestName: extractGuestName(rawTitle, normalizedTitle, personId),
      stayStatus,
      roomId: room.id,
      visibility: "private",
      confidence: personId ? 0.91 : 0.74,
    };
  }

  if (
    (scopeHint && SHARED_SPACE_RE.test(scopeHint)) ||
    /\bstay\s+(?:on\s+(?:the\s+)?)?(?:couch|sofa|floor)\b/.test(normalizedTitle)
  ) {
    return {
      rawTitle,
      normalizedTitle,
      type: "stay",
      scope: "shared_space",
      personId,
      guestName: extractGuestName(rawTitle, normalizedTitle, personId),
      stayStatus,
      visibility: "private",
      confidence: personId ? 0.91 : 0.74,
    };
  }

  return {
    rawTitle,
    normalizedTitle,
    type: "stay",
    scope: "unknown",
    personId,
    guestName: extractGuestName(rawTitle, normalizedTitle, personId),
    stayStatus,
    visibility: "private",
    confidence: personId ? 0.68 : 0.52,
  };
}

function fallbackPresenceParse(
  normalizedTitle: string,
  personId?: string,
): ParsedCalendarEvent | undefined {
  if (!personId) {
    return undefined;
  }

  const bracketHint = extractBracketHint(normalizedTitle);

  if (
    OUT_RE.test(normalizedTitle) &&
    inferPresenceStatus(normalizedTitle) === "confirmed"
  ) {
    const locationMatch = normalizedTitle.match(/\bout of ([^)]+)$/i);

    return {
      rawTitle: normalizedTitle,
      normalizedTitle,
      type: "presence",
      scope: "location",
      personId,
      location: locationMatch?.[1]?.trim() ?? bracketHint,
      presenceState: "out",
      visibility: "private",
      confidence: bracketHint || locationMatch ? 0.9 : 0.82,
    };
  }

  if (
    bracketHint &&
    !STAY_RE.test(normalizedTitle) &&
    !OUT_RE.test(normalizedTitle) &&
    !isNotStayingHint(bracketHint)
  ) {
    const { location, occupiesDefaultRoom, presenceStatus } =
      parsePresenceLocationDetails(bracketHint);

    return {
      rawTitle: normalizedTitle,
      normalizedTitle,
      type: "presence",
      scope: "location",
      personId,
      location,
      occupiesDefaultRoom,
      presenceStatus: presenceStatus ?? inferPresenceStatus(normalizedTitle),
      presenceState: "in",
      visibility: "private",
      confidence: 0.86,
    };
  }

  if (IN_RE.test(normalizedTitle)) {
    const locationMatch = normalizedTitle.match(/(?:^|\b)(maybe\s+)?in (.+)$/i);
    const { location, occupiesDefaultRoom, presenceStatus } =
      parsePresenceLocationDetails(locationMatch?.[2]?.trim());

    const inferredPresenceStatus =
      locationMatch?.[1] || inferPresenceStatus(normalizedTitle) === "tentative"
        ? "tentative"
        : (presenceStatus ?? inferPresenceStatus(normalizedTitle));

    return {
      rawTitle: normalizedTitle,
      normalizedTitle,
      type: "presence",
      scope: "location",
      personId,
      location,
      occupiesDefaultRoom,
      presenceStatus: inferredPresenceStatus,
      presenceState: "in",
      visibility: "private",
      confidence: locationMatch ? 0.82 : 0.7,
    };
  }

  return undefined;
}

export function parseEventTitle(
  title: string,
  configInput: HouseConfig,
): ParsedCalendarEvent {
  const config = houseConfigSchema.parse(configInput);
  const canonicalTitle = canonicalizeTitle(title);
  const normalizedTitle = normalizeTitle(title);
  const strippedCanonicalTitle = stripTentativeMarkers(canonicalTitle);
  const strippedNormalizedTitle = stripTentativeMarkers(normalizedTitle);
  const notStayingStrippedCanonicalTitle =
    stripNotStayingMarker(canonicalTitle);
  const notStayingStrippedNormalizedTitle =
    stripNotStayingMarker(normalizedTitle);
  const strippedCanonicalTitleWithoutNotStaying = stripNotStayingMarker(
    strippedCanonicalTitle,
  );
  const strippedNormalizedTitleWithoutNotStaying = stripNotStayingMarker(
    strippedNormalizedTitle,
  );
  const personId = findPersonId(normalizedTitle, config);
  const guestName = extractGuestName(title, normalizedTitle, personId);
  const explicitMatch = matchExplicitRule(
    [
      ...new Set([
        canonicalTitle,
        normalizedTitle,
        strippedCanonicalTitle,
        strippedNormalizedTitle,
        notStayingStrippedCanonicalTitle,
        notStayingStrippedNormalizedTitle,
        strippedCanonicalTitleWithoutNotStaying,
        strippedNormalizedTitleWithoutNotStaying,
      ]),
    ],
    normalizedTitle,
    config,
  );

  if (explicitMatch) {
    return {
      ...explicitMatch,
      rawTitle: title,
      normalizedTitle,
      guestName:
        explicitMatch.type === "stay"
          ? (explicitMatch.guestName ?? guestName)
          : undefined,
      stayStatus:
        explicitMatch.type === "stay"
          ? inferStayStatus(normalizedTitle)
          : undefined,
      personId: explicitMatch.personId ?? personId,
    };
  }

  const templatedPresenceMatch = matchTemplatedPresenceRule(
    normalizedTitle,
    config,
  );

  if (templatedPresenceMatch) {
    return {
      ...templatedPresenceMatch,
      rawTitle: title,
      normalizedTitle,
      personId: templatedPresenceMatch.personId ?? personId,
    };
  }

  const stayMatch = fallbackStayParse(title, normalizedTitle, config, personId);
  if (stayMatch) {
    return {
      ...stayMatch,
      rawTitle: title,
      normalizedTitle,
    };
  }

  const presenceMatch = fallbackPresenceParse(normalizedTitle, personId);
  if (presenceMatch) {
    return {
      ...presenceMatch,
      rawTitle: title,
      normalizedTitle,
    };
  }

  return {
    rawTitle: title,
    normalizedTitle,
    type: "unknown",
    scope: "unknown",
    personId,
    visibility: "private",
    confidence: 0.12,
  };
}
