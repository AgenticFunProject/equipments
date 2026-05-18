# Versions

Every service version bump must add or update an entry in this file.

## Unreleased

- Added Users Service admin JWT support for Equipments auth and documented the shared issuer, audience, and signing-secret configuration required for deployment.
- Aligned the production Docker runtime and documented engine requirement to Node 22.5+ so deployments support the built-in `node:sqlite` API used by the service.
- Added Azure Container Apps deployment scaffolding and a PostgreSQL-first production runbook covering Key Vault secrets, health probes, replica defaults, migration order, verification, and rollback guidance.
- Changed `npm run migrate` and `npm run migrate:status` to execute compiled `dist/` output so the production migration job works inside the runtime image, and added `migrate:dev` aliases for source-based local workflows.

## 0.2.0

- Added PostgreSQL runtime persistence so the service can start against a migrated PostgreSQL database.
- Added PostgreSQL verification guidance and an opt-in persistence test for local PostgreSQL-backed reservation and container flows.

## Entry Format

When the version changes, add a section like this:

```md
## 0.2.0

- Added bearer-token authentication.
- Added playground token generator.
- Added audit logging for authenticated write actions.
```
