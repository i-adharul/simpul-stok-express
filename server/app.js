const express = require("express");
const requestLogger = require("./middlewares/requestLogger");
const routes = require("./routes");
const { errorHandler, notFoundHandler } = require("./middlewares/errorHandler");

const app = express();

// First, so every request is logged, including those the body parser or a route rejects.
app.use(requestLogger);
app.use(express.json());

app.use("/api", routes);

// Express does not treat "no route matched" as an error, so the error handler never sees it.
// This must stay below every route, and the error handler below it.
app.use(notFoundHandler);
app.use(errorHandler);

// The app is exported without listening so tests can call it without a port.
module.exports = app;
