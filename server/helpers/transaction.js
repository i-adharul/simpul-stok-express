const { sequelize } = require("../models");

// The one door to a database transaction for services (they may not import models, rule 3).
// `work` receives the transaction and must pass it on as `{ transaction }` to every query it
// wants inside; it commits when `work` resolves and rolls everything back when it throws.
const inTransaction = (work) => sequelize.transaction(work);

module.exports = { inTransaction };
