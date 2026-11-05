const { z } = require("zod");

// Default messages for every kind of Zod issue, in Indonesian (docs/04: messages are shown to
// users). A message written inside a schema, e.g. z.string().min(3, "..."), still wins over
// these, because Zod uses the schema's own message before the global one.
function messageFor(issue) {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? "Wajib diisi." : "Tipe data tidak valid.";
    case "too_small":
      return issue.origin === "string"
        ? `Minimal ${issue.minimum} karakter.`
        : issue.origin === "array"
          ? `Minimal ${issue.minimum} item.`
          : `Minimal ${issue.minimum}.`;
    case "too_big":
      return issue.origin === "string"
        ? `Maksimal ${issue.maximum} karakter.`
        : issue.origin === "array"
          ? `Maksimal ${issue.maximum} item.`
          : `Maksimal ${issue.maximum}.`;
    case "invalid_format":
      return "Format tidak valid.";
    case "invalid_value":
      return "Nilai tidak diizinkan.";
    case "unrecognized_keys":
      return "Field tidak dikenal.";
    default:
      return "Nilai tidak valid.";
  }
}

// Global, once: every schema in the app (also the env schema) gets these defaults.
z.config({ customError: messageFor });

// Zod issues -> [{ source, path, message }] (docs/04, VALIDATION_ERROR). `source` is where the
// value came from: header, query, params or body. An unknown-keys issue lists many keys at once;
// it becomes one line per key so the client sees exactly which fields to remove.
function toDetails(source, issues) {
  return issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        source,
        path: [...issue.path, key].join("."),
        message: issue.message,
      }));
    }
    return [{ source, path: issue.path.join("."), message: issue.message }];
  });
}

module.exports = { toDetails, messageFor };
