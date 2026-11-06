const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const env = require("./config/env");
const requestLogger = require("./middlewares/requestLogger");
const routes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middlewares/errorHandler");

const app = express();

// First, so every request is logged, including those the body parser or a route rejects.
app.use(requestLogger);
// Security headers on every response, errors included (and it removes X-Powered-By). The defaults
// are kept: this is a JSON API, so a strict Content-Security-Policy costs nothing.
app.use(helmet());
// Only the origins listed in CORS_ORIGIN get Access-Control-Allow-Origin; any other origin gets no
// CORS headers, so the browser refuses to hand the response to its page. There is no wildcard
// (the env schema refuses "*") and no credentials: the token travels in the Authorization header,
// not in a cookie (ADR 0010). Requests without an Origin header (curl, servers) are not affected.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id", "Idempotency-Replayed"],
    maxAge: 600,
  }),
);
app.use(express.json());

app.use("/api", routes);

// Express does not treat "no route matched" as an error, so the error handler never sees it.
// This must stay below every route, and the error handler below it.
app.use(notFoundHandler);
app.use(errorHandler);

// The app is exported without listening so tests can call it without a port.
module.exports = app;
