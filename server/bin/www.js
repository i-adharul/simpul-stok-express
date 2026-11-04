// env must load first: a bad configuration stops the process before anything else runs.
const { PORT } = require("../config/env");
const app = require("../app");

// Express 5 passes a listen failure (for example EADDRINUSE) to this callback.
app.listen(PORT, (error) => {
  if (error) {
    console.error(`Cannot listen on port ${PORT}: ${error.code}`);
    process.exit(1);
  }
  console.log(`Server listening on port ${PORT}`);
});
