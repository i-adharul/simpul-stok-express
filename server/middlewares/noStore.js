// Responses that carry a token or a session decision must never be kept by a browser or a proxy
// (docs/04, Authentication). Set before the handler runs, so error responses carry it too.
module.exports = function noStore(req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
};
