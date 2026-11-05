const {
  validatePassword,
  COMMON_PASSWORDS,
  REASONS,
} = require("../helpers/password");

const email = "Budi.Santoso@Toko.co.id";

describe("validatePassword: accepted", () => {
  it.each([
    ["8 characters, letters and a digit", "abcdefg1"],
    ["72 characters", `${"a".repeat(71)}1`],
    ["mixed case with symbols", "Gula&Kopi#2026"],
    ["a space inside", "gula kopi 2026"],
    ["a non-Latin letter", "кофе2026x"],
    ["close to a common password but not on the list", "password123456"],
  ])("%s", (_name, password) => {
    expect(validatePassword(password, { email })).toEqual({ valid: true });
  });

  it("works without an email", () => {
    expect(validatePassword("abcdefg1")).toEqual({ valid: true });
  });
});

describe("validatePassword: rejected", () => {
  it.each([
    ["too short (7)", "abcdef1", REASONS.TOO_SHORT],
    ["empty", "", REASONS.TOO_SHORT],
    ["not a string (undefined)", undefined, REASONS.TOO_SHORT],
    ["not a string (number)", 12345678, REASONS.TOO_SHORT],
    ["73 characters", `${"a".repeat(72)}1`, REASONS.TOO_LONG],
    ["72 characters but more than 72 bytes", `${"é".repeat(36)}1`.padEnd(72, "a"), REASONS.TOO_LONG],
    ["digits only", "98765432", REASONS.NEEDS_LETTER_AND_DIGIT],
    ["letters only", "abcdefgh", REASONS.NEEDS_LETTER_AND_DIGIT],
    ["symbols and digits only", "!!!!1111", REASONS.NEEDS_LETTER_AND_DIGIT],
  ])("%s", (_name, password, reason) => {
    const result = validatePassword(password, { email });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.message).toMatch(/^Password /);
  });
});

describe("validatePassword: the email rule", () => {
  it("rejects the full email, in any letter case", () => {
    const result = validatePassword("budi123@toko.id", { email: "BUDI123@toko.id" });

    expect(result).toMatchObject({ valid: false, reason: REASONS.SAME_AS_EMAIL });
  });

  it("rejects the part before the @, in any letter case", () => {
    const result = validatePassword("BUDI12345", { email: "budi12345@toko.id" });

    expect(result).toMatchObject({ valid: false, reason: REASONS.SAME_AS_EMAIL });
  });

  it("ignores spaces around the email", () => {
    const result = validatePassword("budi12345", { email: "  budi12345@toko.id " });

    expect(result.reason).toBe(REASONS.SAME_AS_EMAIL);
  });

  it("allows a password that only contains the local part", () => {
    expect(validatePassword("budi12345-2026", { email: "budi12345@toko.id" })).toEqual({
      valid: true,
    });
  });

  it("does not apply when no email is given", () => {
    expect(validatePassword("budi12345", {})).toEqual({ valid: true });
    expect(validatePassword("budi12345", { email: "" })).toEqual({ valid: true });
  });
});

describe("validatePassword: the common password list", () => {
  it("has exactly 38 distinct entries, all in lower case", () => {
    expect(COMMON_PASSWORDS).toHaveLength(38);
    expect(new Set(COMMON_PASSWORDS).size).toBe(38);
    expect(COMMON_PASSWORDS.every((p) => p === p.toLowerCase())).toBe(true);
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(COMMON_PASSWORDS)).toBe(true);
  });

  it.each(["password123", "Password123", "PASSWORD123", "Qwerty123", "ADMIN123", "Bismillah123"])(
    "rejects %s, whatever the letter case",
    (password) => {
      expect(validatePassword(password)).toMatchObject({
        valid: false,
        reason: REASONS.COMMON,
        message: "Password terlalu umum.",
      });
    },
  );

  // Entries without a letter or without a digit stop earlier, at the letter-and-digit rule; the
  // others must reach the list check. This keeps the list honest: each entry has an effect.
  it("every entry is refused, by the list or by an earlier rule", () => {
    for (const entry of COMMON_PASSWORDS) {
      expect(validatePassword(entry).valid).toBe(false);
    }
  });

  it("entries that have letters and digits are refused because of the list", () => {
    const reachable = COMMON_PASSWORDS.filter((p) => /\p{L}/u.test(p) && /[0-9]/.test(p));

    expect(reachable.length).toBeGreaterThan(25);
    for (const entry of reachable) {
      expect(validatePassword(entry).reason).toBe(REASONS.COMMON);
    }
  });
});

describe("validatePassword: messages", () => {
  it("uses the messages of docs/02 for length, character mix and common passwords", () => {
    expect(validatePassword("abc1").message).toBe(
      "Password harus minimal 8 karakter dan mengandung huruf serta angka.",
    );
    expect(validatePassword("abcdefgh").message).toBe(
      "Password harus minimal 8 karakter dan mengandung huruf serta angka.",
    );
    expect(validatePassword("password123").message).toBe("Password terlalu umum.");
  });
});
