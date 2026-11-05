# API documentation

A short, runnable guide to the endpoints that exist. The contract (every field, status and error
code) is `docs/04_API_Spec.md`; each resource also has a `.http` file in `http/` to try it from
VS Code. Local server: `cd server && npm run dev` (port 3000).

All tenant endpoints need `Authorization: Bearer <token>` from `POST /api/auth/login`. Errors are
always `{ "code", "message", "details" }`. A role without the right gets `403` before the input is
read; an ID that is missing, malformed or belongs to another organization gets `404`.

## Warehouses (`http/warehouses.http`)

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/warehouses` | every tenant role | Paged list. Query `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (`true` or `false`, Owner only). Owner: all active warehouses; Warehouse Admin and Viewer: the assigned ones. Ordered by `code`, then `id`. |
| `GET /api/warehouses/:id` | every tenant role | The warehouse plus `assignedUsers` (`id`, `name`, `role`; no email). `403` for a Warehouse Admin or Viewer who is not assigned; an archived warehouse is visible to the Owner only. |
| `POST /api/warehouses` | Owner | Body `code` (1 to 20 characters, stored uppercase, unique per organization), `name` (1 to 100), optional `address` (at most 255, empty is stored as null). `409` "Kode gudang sudah dipakai." when the code exists. |
| `PATCH /api/warehouses/:id` | Owner | Body with at least one of `code`, `name`, `address` (same rules as `POST`). `archived` arrives with the archive story. |

Example:

```bash
curl -X POST http://localhost:3000/api/warehouses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"code":"gd-sudirman","name":"Gudang Sudirman"}'
# 201 {"id":"...","organizationId":"...","code":"GD-SUDIRMAN","name":"Gudang Sudirman","address":null,...}
```
