const { sequelize } = require("../models");

// The one door to a database transaction for services (they may not import models, rule 3).
// `work` receives the transaction and must pass it on as `{ transaction }` to every query it
// wants inside; it commits when `work` resolves and rolls everything back when it throws.
const inTransaction = (work) => sequelize.transaction(work);

// A SAVEPOINT inside the caller's transaction. When `work` throws, only what it did is rolled
// back and the outer transaction stays usable; a plain failed statement would leave Postgres in
// "current transaction is aborted" and every later query would fail. Used where one statement is
// allowed to fail and be retried (the unique code of a transfer).
const inSavepoint = (transaction, work) => sequelize.transaction({ transaction }, work);

module.exports = { inTransaction, inSavepoint };
