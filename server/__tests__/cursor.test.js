const { encodeCursor, decodeCursor } = require("../helpers/cursor");

const position = { createdAt: new Date("2026-11-05T03:04:05.678Z"), id: "3f2b8c1e-9d4a-4e6b-8f10-a1b2c3d4e5f6" };

describe("cursor", () => {
  it("round-trips a position", () => {
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it("is opaque: base64url text without the id or the instant in clear", () => {
    const text = encodeCursor(position);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text).not.toContain(position.id);
    expect(text).not.toContain("2026");
  });

  const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  it.each([
    ["an empty string", ""],
    ["plain text", "abc"],
    ["text with characters outside base64url", "ab+/=="],
    ["base64url that is not JSON", b64("not json")],
    ["JSON that is not an object", b64("[1]")],
    ["JSON null", b64("null")],
    ["a missing id", b64({ t: position.createdAt.toISOString() })],
    ["a missing instant", b64({ i: position.id })],
    ["an id that is not a UUID", b64({ t: position.createdAt.toISOString(), i: "x" })],
    ["an instant that is not ISO as written by encodeCursor", b64({ t: "2026-11-05", i: position.id })],
    ["an extra key", b64({ t: position.createdAt.toISOString(), i: position.id, x: 1 })],
    ["a number", 5],
    ["undefined", undefined],
  ])("returns null for %s", (_name, value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
