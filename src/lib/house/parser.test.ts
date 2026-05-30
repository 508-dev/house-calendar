import { describe, expect, test } from "bun:test";
import { parseEventTitle } from "./parser";
import { exampleHouseConfig } from "./sample-data";

describe("parseEventTitle", () => {
  test("parses whole-house stays from explicit rules", () => {
    const parsed = parseEventTitle(
      "Someone stays (whole house)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.scope).toBe("house");
    expect(parsed.visibility).toBe("private");
    expect(parsed.personId).toBeUndefined();
    expect(parsed.confidence).toBe(0.99);
  });

  test("keeps explicit stay rules matchable after title normalization", () => {
    const parsed = parseEventTitle(
      "Someone stays (guest room)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.scope).toBe("room");
    expect(parsed.roomId).toBe("guest-room");
    expect(parsed.guestName).toBe("Someone");
    expect(parsed.visibility).toBe("private");
    expect(parsed.confidence).toBe(0.97);
  });

  test("captures guest names separately from known housemates", () => {
    const parsed = parseEventTitle(
      "Charlie stays [Guest Room]",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.personId).toBeUndefined();
    expect(parsed.guestName).toBe("Charlie");
    expect(parsed.roomId).toBe("guest-room");
  });

  test("does not store a guest name for configured housemates", () => {
    const parsed = parseEventTitle(
      "Michael stays (guest room)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.personId).toBe("michael");
    expect(parsed.guestName).toBeUndefined();
    expect(parsed.roomId).toBe("guest-room");
  });

  test("treats parenthetical tentative stay markers as tentative room stays", () => {
    const parsed = parseEventTitle(
      "Kirika stays (guest room, tentative)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.scope).toBe("room");
    expect(parsed.guestName).toBe("Kirika");
    expect(parsed.roomId).toBe("guest-room");
    expect(parsed.stayStatus).toBe("tentative");
    expect(parsed.confidence).toBe(0.97);
  });

  test("treats maybe stays as tentative room stays", () => {
    const parsed = parseEventTitle(
      "Kirika maybe stays (guest room)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.scope).toBe("room");
    expect(parsed.guestName).toBe("Kirika");
    expect(parsed.roomId).toBe("guest-room");
    expect(parsed.stayStatus).toBe("tentative");
    expect(parsed.confidence).toBe(0.97);
  });

  test("treats crashes as a default stay keyword", () => {
    const parsed = parseEventTitle(
      "Charlie crashes (guest room)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("stay");
    expect(parsed.scope).toBe("room");
    expect(parsed.guestName).toBe("Charlie");
    expect(parsed.roomId).toBe("guest-room");
  });

  test("parses shared-space crashes without assigning a room", () => {
    const couch = parseEventTitle(
      "Charlie crashes on the couch",
      exampleHouseConfig,
    );
    const ongoingCouch = parseEventTitle(
      "Charlie is crashing on the couch",
      exampleHouseConfig,
    );
    const sofa = parseEventTitle("Charlie crashing (sofa)", exampleHouseConfig);
    const floor = parseEventTitle(
      "Charlie crashes on the floor",
      exampleHouseConfig,
    );

    expect(couch.type).toBe("stay");
    expect(couch.scope).toBe("shared_space");
    expect(couch.guestName).toBe("Charlie");
    expect(couch.roomId).toBeUndefined();
    expect(ongoingCouch.type).toBe("stay");
    expect(ongoingCouch.scope).toBe("shared_space");
    expect(ongoingCouch.guestName).toBe("Charlie");
    expect(ongoingCouch.roomId).toBeUndefined();
    expect(sofa.type).toBe("stay");
    expect(sofa.scope).toBe("shared_space");
    expect(sofa.guestName).toBe("Charlie");
    expect(sofa.roomId).toBeUndefined();
    expect(floor.type).toBe("stay");
    expect(floor.scope).toBe("shared_space");
    expect(floor.guestName).toBe("Charlie");
    expect(floor.roomId).toBeUndefined();
  });

  test("parses templated public housemate travel", () => {
    const parsed = parseEventTitle(
      "Michael out of Japan (Europe)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("out");
    expect(parsed.personId).toBe("michael");
    expect(parsed.location).toBe("europe");
    expect(parsed.visibility).toBe("public");
  });

  test("does not promote maybe out travel into a confirmed departure", () => {
    const parsed = parseEventTitle(
      "Michael maybe out of Japan",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("unknown");
    expect(parsed.personId).toBe("michael");
  });

  test("does not let stripped tentative departure markers match explicit out rules", () => {
    const parsed = parseEventTitle(
      "Michael out of Japan (tentative)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("unknown");
    expect(parsed.personId).toBe("michael");
  });

  test("supports bracket shorthand for templated departure presence", () => {
    const parsed = parseEventTitle("Michael out [Japan]", exampleHouseConfig);

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("out");
    expect(parsed.location).toBe("japan");
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("supports bracket shorthand for templated presence", () => {
    const parsed = parseEventTitle("Michael [TPE]", exampleHouseConfig);

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.location).toBe("tpe");
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("supports bracket shorthand for local presence without staying", () => {
    const parsed = parseEventTitle(
      "Michael [Tokyo, not staying]",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.occupiesDefaultRoom).toBe(false);
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("supports bare not staying presence annotations", () => {
    const parsed = parseEventTitle("Michael (not staying)", exampleHouseConfig);

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.location).toBeUndefined();
    expect(parsed.occupiesDefaultRoom).toBe(false);
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("supports text shorthand for templated presence", () => {
    const parsed = parseEventTitle("Michael in Tokyo", exampleHouseConfig);

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.presenceStatus).toBe("confirmed");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("treats maybe presence titles as tentative", () => {
    const parsed = parseEventTitle(
      "Michael maybe in Tokyo",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.presenceStatus).toBe("tentative");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("treats bracket tentative presence markers as tentative", () => {
    const parsed = parseEventTitle(
      "Michael [Tokyo, tentative]",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.presenceStatus).toBe("tentative");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("supports text presence without staying", () => {
    const parsed = parseEventTitle(
      "Michael in Tokyo (not staying)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.presenceStatus).toBe("confirmed");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.occupiesDefaultRoom).toBe(false);
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("public");
  });

  test("keeps explicit private presence rules matched for not staying titles", () => {
    const parsed = parseEventTitle("Michael in Tokyo (not staying)", {
      ...exampleHouseConfig,
      rules: [
        ...exampleHouseConfig.rules,
        {
          actorId: "michael",
          match: "^michael in tokyo$",
          type: "presence.in",
          visibility: "private",
        },
      ],
    });

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.personId).toBe("michael");
    expect(parsed.presenceStatus).toBe("confirmed");
    expect(parsed.occupiesDefaultRoom).toBe(false);
    expect(parsed.visibility).toBe("private");
  });

  test("keeps fallback presence parsing aware of not staying suffixes", () => {
    const parsed = parseEventTitle(
      "Michael currently in Tokyo (not staying)",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("in");
    expect(parsed.presenceStatus).toBe("confirmed");
    expect(parsed.location).toBe("tokyo");
    expect(parsed.occupiesDefaultRoom).toBe(false);
    expect(parsed.personId).toBe("michael");
    expect(parsed.visibility).toBe("private");
  });

  test("keeps heuristic presence parses private by default", () => {
    const parsed = parseEventTitle(
      "Michael away for surgery",
      exampleHouseConfig,
    );

    expect(parsed.type).toBe("presence");
    expect(parsed.presenceState).toBe("out");
    expect(parsed.visibility).toBe("private");
  });
});
