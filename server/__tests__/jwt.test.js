const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { signToken, verifyToken } = require("../helpers/jwt");

const userId = "6f1c3a52-0d8c-4a7e-9f0e-1c6b0a1b2c3d";

describe("helpers/jwt", () => {
  it("signs a token with only sub, iat and exp", () => {
    const payload = jwt.decode(signToken(userId));

    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(userId);
  });

  it("expires after 8 hours with the default env value", () => {
    const { iat, exp } = jwt.decode(signToken(userId));

    expect(env.JWT_EXPIRES_IN).toBe("8h");
    expect(exp - iat).toBe(8 * 60 * 60);
  });

  it("is signed with HS256", () => {
    const header = jwt.decode(signToken(userId), { complete: true }).header;

    expect(header.alg).toBe("HS256");
  });

  it("verifies its own token and returns the payload", () => {
    const payload = verifyToken(signToken(userId));

    expect(payload.sub).toBe(userId);
  });

  it("rejects a token signed with another secret", () => {
    const forged = jwt.sign({}, "x".repeat(40), { subject: userId, expiresIn: "8h" });

    expect(() => verifyToken(forged)).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects an expired token with TokenExpiredError", () => {
    const expired = signToken(userId, "-1s");

    expect(() => verifyToken(expired)).toThrow(jwt.TokenExpiredError);
  });

  it("rejects an unsigned token (alg none)", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: userId })).toString("base64url");

    expect(() => verifyToken(`${header}.${body}.`)).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects a token signed with another algorithm (HS512) even with the right secret", () => {
    const other = jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: "8h", algorithm: "HS512" });

    expect(() => verifyToken(other)).toThrow(jwt.JsonWebTokenError);
  });

  it("rejects garbage", () => {
    expect(() => verifyToken("garbage")).toThrow(jwt.JsonWebTokenError);
  });
});
