const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// The cursor of the history (BL16, keyset pagination): the position of the last row of a page,
// (createdAt, id), as base64url JSON. It is opaque to the client, which only sends back what
// `nextCursor` gave. It holds no organization and no row lookup: it is only a position that
// becomes part of a scoped query, so a cursor made by hand cannot reach another organization's data.
// `createdAt` is kept to the millisecond: Sequelize writes it from a JavaScript Date.
const encodeCursor = ({ createdAt, id }) =>
  Buffer.from(JSON.stringify({ t: createdAt.toISOString(), i: id })).toString("base64url");

// Returns { createdAt: Date, id } or null for anything that is not a cursor made by encodeCursor
// (not base64url, not JSON, wrong shape, a bad instant or a bad id). Never throws.
function decodeCursor(text) {
  if (typeof text !== "string" || !BASE64URL.test(text)) return null;
  try {
    const { t, i, ...extra } = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    const createdAt = new Date(t);
    const valid =
      Object.keys(extra).length === 0 &&
      typeof t === "string" &&
      !Number.isNaN(createdAt.getTime()) &&
      createdAt.toISOString() === t &&
      typeof i === "string" &&
      UUID.test(i);
    return valid ? { createdAt, id: i.toLowerCase() } : null;
  } catch {
    return null;
  }
}

module.exports = { encodeCursor, decodeCursor };
