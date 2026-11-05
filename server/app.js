const express = require("express");
const helmet = require("helmet");
const requestLogger = require("./middlewares/requestLogger");
const routes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middlewares/errorHandler");

const app = express();

// First, so every request is logged, including those the body parser or a route rejects.
app.use(requestLogger);
// Security headers on every response, errors included (and it removes X-Powered-By). The defaults
// are kept: this is a JSON API, so a strict Content-Security-Policy costs nothing.
app.use(helmet());
app.use(express.json());

app.use("/api", routes);

// Express does not treat "no route matched" as an error, so the error handler never sees it.
// This must stay below every route, and the error handler below it.
app.use(notFoundHandler);
app.use(errorHandler);

// The app is exported without listening so tests can call it without a port.
module.exports = app;
