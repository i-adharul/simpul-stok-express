// Starts `n` calls of `fn` in the same tick and resolves when all of them finished (Promise.all).
// `fn` receives the index 0..n-1 and may return a promise; a rejection rejects the whole call, so
// callers pass a `fn` that resolves to the HTTP response (Supertest resolves on 4xx and 5xx too).
// Nothing is awaited between the starts: every request is already on its way to the server before
// the first one has been answered, which is what makes the calls overlap.
function runConcurrently(n, fn) {
  if (!Number.isInteger(n) || n < 1) throw new Error("runConcurrently: n must be a positive integer");
  return Promise.all(Array.from({ length: n }, (_, index) => fn(index)));
}

module.exports = { runConcurrently };
