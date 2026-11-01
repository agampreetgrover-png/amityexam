import { describe, expect, it } from "vitest";
import { dbNameOf, LOCAL, ownerOf, parseProfile, resolveProfile, serializeProfile } from "./profile";

const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("parseProfile", () => {
  it("treats nothing stored, and 'local', as Local Mode", () => {
    expect(parseProfile(null)).toEqual(LOCAL);
    expect(parseProfile("local")).toEqual(LOCAL);
  });
  it("reads a cloud profile (user ids compared in lower case)", () => {
    expect(parseProfile(`u:${A.toUpperCase()}`)).toEqual({ kind: "user", userId: A });
  });
  it("calls anything else invalid instead of guessing", () => {
    for (const raw of ["", "u:", "u:not-a-uuid", "user:" + A, "LOCAL", `u:${A}x`]) expect(parseProfile(raw)).toBe("invalid");
  });
  it("round-trips through serializeProfile", () => {
    expect(parseProfile(serializeProfile({ kind: "user", userId: A }))).toEqual({ kind: "user", userId: A });
    expect(parseProfile(serializeProfile(LOCAL))).toEqual(LOCAL);
  });
});

describe("resolveProfile", () => {
  it("opens Local Mode when nothing is stored, signed in or not", () => {
    expect(resolveProfile(null, null)).toEqual({ status: "open", profile: LOCAL });
    expect(resolveProfile(null, A)).toEqual({ status: "open", profile: LOCAL });
    expect(resolveProfile("local", A)).toEqual({ status: "open", profile: LOCAL });
  });
  it("opens a cloud profile only for the same signed-in user (online check or stored session offline)", () => {
    expect(resolveProfile(`u:${A}`, A)).toEqual({ status: "open", profile: { kind: "user", userId: A } });
    expect(resolveProfile(`u:${A}`, A.toUpperCase())).toEqual({ status: "open", profile: { kind: "user", userId: A } });
  });
  it("opens nothing when the cloud profile has no session (e.g. offline with no stored session)", () => {
    expect(resolveProfile(`u:${A}`, null)).toEqual({ status: "needs-signin", userId: A });
  });
  it("opens nothing when a different user is signed in", () => {
    expect(resolveProfile(`u:${A}`, B)).toEqual({ status: "needs-signin", userId: A });
  });
  it("opens nothing for an unrecognised stored value", () => {
    expect(resolveProfile("u:garbage", A)).toEqual({ status: "needs-signin", userId: null });
  });
});

describe("database names and owners", () => {
  it("keeps the original database for Local Mode and gives each account its own", () => {
    expect(dbNameOf(LOCAL)).toBe("amityexams");
    expect(dbNameOf({ kind: "user", userId: A })).toBe(`amityexams-u-${A}`);
    expect(dbNameOf({ kind: "user", userId: A })).not.toBe(dbNameOf({ kind: "user", userId: B }));
    expect(ownerOf(LOCAL)).toBe("local");
    expect(ownerOf({ kind: "user", userId: A })).toBe(A);
  });
});
