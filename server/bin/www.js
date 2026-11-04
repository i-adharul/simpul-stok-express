const app = require("../app");

// Temporary: moves to the validated env object when config/env.js exists.
const PORT = 3000;

// Express 5 passes a listen failure (for example EADDRINUSE) to this callback.
app.listen(PORT, (error) => {
  if (error) {
    console.error(`Cannot listen on port ${PORT}: ${error.code}`);
    process.exit(1);
  }
  console.log(`Server listening on port ${PORT}`);
});
