// Offset paging for the list endpoints (docs/04: page, pageSize, and a total in the answer).
// The numbers arrive already validated by the list query schema (schemas/pagination.schema.js).
const pageWindow = ({ page, pageSize }) => ({ limit: pageSize, offset: (page - 1) * pageSize });

const pageBody = (items, total, { page, pageSize }) => ({ items, total, page, pageSize });

module.exports = { pageWindow, pageBody };
