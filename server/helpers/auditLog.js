const { tenant } = require("./tenantScope");

// The one door to write an AuditLog row (BL26). Wiring it into the other actions is E13-01.
//
// `organizationId` is the organization the row belongs to. For a normal action it is
// req.ctx.organizationId; for a Platform admin acting on a tenant (BL25) it is the target
// organization, which the caller has already loaded from the database, never a raw request value.
// The row is written through tenant(), so it always carries exactly that organization.

// Same shape as the database CHECK "AuditLogs_action_check", so a bad value fails here with a
// clear message before any query is sent.
const ACTION_FORMAT = /^[a-z]+(\.[a-z]+)+$/;
const ACTION_MAX = 100;

function assertAction(action) {
  if (typeof action !== "string" || action.length > ACTION_MAX || !ACTION_FORMAT.test(action)) {
    // A programming error, not a client error: a wrong action name is a bug in the caller.
    throw new Error(`audit action must look like entity.action in lowercase letters, got ${JSON.stringify(action)}`);
  }
}

function assertMetadata(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("audit metadata must be a plain object");
  }
}

// Async on purpose: a bad argument is a rejected promise, the same shape as a database failure.
// Pass `{ transaction }` to write inside the transaction of the change being described: if that
// change rolls back, the audit row rolls back with it.
async function writeAuditLog(
  { organizationId, actorId = null, action, entityType, entityId = null, metadata = {} },
  { transaction } = {},
) {
  assertAction(action);
  assertMetadata(metadata);
  return tenant({ organizationId }).AuditLog.create(
    { actorId, action, entityType, entityId, metadata },
    { transaction },
  );
}

module.exports = { writeAuditLog, ACTION_FORMAT };
