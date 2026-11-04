const express = require("express");

const app = express();

app.use(express.json());

// Express does not treat "no route matched" as an error, so the error handler
// never sees it. This must stay below every route.
app.use((req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Data tidak ditemukan.",
    details: null,
  });
});

// The app is exported without listening so tests can call it without a port.
module.exports = app;
