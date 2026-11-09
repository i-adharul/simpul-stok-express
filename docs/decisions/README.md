# Architecture decision records

One file per decision. A decision that is replaced stays in the list with its status changed.

The numbers below are reserved from the start so that other documents can refer to them. A record is written in the story named in the last column, and it starts with status `proposed`, which changes to `accepted` once the maintainer agrees (`superseded` when a later record replaces it). The table shows the current status.

| No   | Title                                                                                    | Status   | Story |
| ---- | ---------------------------------------------------------------------------------------- | -------- | ----- |
| 0001 | Express and Sequelize as the stack                                                       | accepted | E0-01 |
| 0002 | A flat structure, with services only for risky logic                                     | accepted | E0-01 |
| 0003 | Database conventions (IDs, names, times, deletes, rules in SQL)                          | accepted | E0-04 |
| 0004 | Sequelize 6 and `sequelize-cli` for migrations and seeders                               | accepted | E0-04 |
| 0005 | Immutable stock movements enforced by a database trigger                                 | accepted | E0-05 |
| 0006 | Tenant integrity enforced by the application, not composite foreign keys                 | accepted | E0-05 |
| 0007 | Supabase connection strategy (session pooler, verified TLS, two roles)                   | accepted | E6-04 |
| 0008 | Deployment layout on EC2 (pm2, Nginx, HTTPS) and the client on Vercel                    | accepted | E6-04 |
| 0009 | A stateless signed JWT (no session table)                                                | accepted | E1-02 |
| 0010 | Bearer token instead of a cookie: no CSRF check, and the XSS trade-off                   | accepted | E1-06 |
| 0011 | Tenant data access helper, enforced by static tests and the cross-tenant harness         | accepted | E2-04 |
| 0012 | Idempotency by a key row written in the same transaction as the business effect          | accepted | E4-01 |
| 0013 | Warehouse row lock as the serialization point for stock writes                           | accepted | E4-02 |
| 0014 | Transfer code without a shared row, and two-warehouse locking for transfers              | accepted | E5-03 |

## Format

```
# ADR 00NN: Title

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD

## Context
Why a decision is needed, and the constraints.

## Decision
What was chosen, in enough detail to implement and to review.

## Alternatives considered
What was rejected, and why.

## Consequences
What gets easier, what gets harder, and what must be watched.
```
