const bcrypt = require("bcryptjs");
const { hashPassword, comparePassword, COST } = require("../helpers/bcrypt");

describe("helpers/bcrypt", () => {
  it("hashes with cost 12", async () => {
    const hash = await hashPassword("Gula-Kopi-2026");

    expect(COST).toBe(12);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.getRounds(hash)).toBe(12);
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
