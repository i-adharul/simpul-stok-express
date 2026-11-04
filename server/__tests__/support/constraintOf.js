// Sequelize turns a unique violation into a generic "Validation error";
// the constraint name stays on the original driver error.
async function constraintOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error.parent.constraint;
  }
  return undefined;
}

module.exports = { constraintOf };
