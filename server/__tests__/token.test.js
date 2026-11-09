const { generateToken, hashToken } = require("../helpers/token");

describe("generateToken", () => {
  it("is 43 URL-safe characters (32 bytes in base64url)", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("gives a different token every time", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));

    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is deterministic: the same token gives the same hash", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("is SHA-256 in hex (64 characters), and known for a known input", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives different hashes for different tokens, and never contains the token", () => {
    const a = generateToken();
    const b = generateToken();

    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toContain(a);
  });
});
