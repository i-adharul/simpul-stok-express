const bcrypt = require("bcryptjs");
const { hashPassword, comparePassword, COST, PRODUCTION_COST } = require("../helpers/bcrypt");
const { bcryptPrefix } = require("./support/bcryptPrefix");

// A fixed hash of "Gula-Kopi-2026" made at cost 12, outside Jest.
const COST_12_HASH = "$2b$12$tCdcxEEjpw9WterFuUofBOReXv.TrcPufXY8uNeL3ekxf9lNU8YiK";

describe("helpers/bcrypt", () => {
  it("hashes with the effective cost", async () => {
    const hash = await hashPassword("Gula-Kopi-2026");

    expect(hash).toMatch(bcryptPrefix(COST));
    expect(bcrypt.getRounds(hash)).toBe(COST);
  });

  it("uses cost 4 under Jest (JEST_WORKER_ID is defined with --runInBand)", async () => {
    // If JEST_WORKER_ID were undefined, COST would be 12 and these assertions would fail.
    expect(process.env.JEST_WORKER_ID).toBeDefined();
    expect(COST).toBe(4);
    expect(PRODUCTION_COST).toBe(12);
    expect(await hashPassword("Gula-Kopi-2026")).toMatch(bcryptPrefix(4));
  });

  it("uses cost 12 in production", async () => {
    const savedEnv = process.env.NODE_ENV;
    const savedWorker = process.env.JEST_WORKER_ID;
    let isolated;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.JEST_WORKER_ID;
      jest.isolateModules(() => {
        // Only helpers/bcrypt.js is loaded here: config/env would validate the environment.
        isolated = require("../helpers/bcrypt");
      });
    } finally {
      process.env.NODE_ENV = savedEnv;
      if (savedWorker === undefined) delete process.env.JEST_WORKER_ID;
      else process.env.JEST_WORKER_ID = savedWorker;
    }

    expect(isolated.COST).toBe(12);
    expect(isolated.PRODUCTION_COST).toBe(12);
    expect(await isolated.hashPassword("Gula-Kopi-2026")).toMatch(bcryptPrefix(12));
  });

  it("compares a password against a hash made with cost 12 outside Jest", async () => {
    expect(COST_12_HASH).toMatch(bcryptPrefix(12));
    await expect(comparePassword("Gula-Kopi-2026", COST_12_HASH)).resolves.toBe(true);
    await expect(comparePassword("gula-kopi-2026", COST_12_HASH)).resolves.toBe(false);
  });

  it("never returns the plain password and salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("Gula-Kopi-2026"), hashPassword("Gula-Kopi-2026")]);

    expect(a).not.toContain("Gula-Kopi-2026");
    expect(a).not.toBe(b);
  });

  it("accepts the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("Gula-Kopi-2026");

    await expect(comparePassword("Gula-Kopi-2026", hash)).resolves.toBe(true);
    await expect(comparePassword("gula-kopi-2026", hash)).resolves.toBe(false);
  });

  it("refuses a password over 72 bytes instead of comparing its first 72 bytes", async () => {
    const hash = await hashPassword("a".repeat(72));

    await expect(comparePassword("a".repeat(72), hash)).resolves.toBe(true);
    // bcrypt alone would answer true here, because it ignores everything after byte 72.
    await expect(comparePassword(`${"a".repeat(72)}zzz`, hash)).resolves.toBe(false);
  });

  it("counts bytes, not characters", async () => {
    const hash = await hashPassword("é".repeat(36));

    await expect(comparePassword("é".repeat(36), hash)).resolves.toBe(true);
    await expect(comparePassword(`${"é".repeat(36)}x`, hash)).resolves.toBe(false);
  });

  it("refuses a value that is not a string, without throwing", async () => {
    const hash = await hashPassword("Gula-Kopi-2026");

    await expect(comparePassword(undefined, hash)).resolves.toBe(false);
    await expect(comparePassword(12345678, hash)).resolves.toBe(false);
  });

  it("refuses a malformed hash without throwing", async () => {
    await expect(comparePassword("Gula-Kopi-2026", "not-a-hash")).resolves.toBe(false);
  });
});
