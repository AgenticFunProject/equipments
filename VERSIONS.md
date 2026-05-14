# Versions

Every service version bump must add or update an entry in this file.

## Unreleased

- Added Azure Container Apps deployment scaffolding and a PostgreSQL-first production runbook covering Key Vault secrets, health probes, replica defaults, migration order, verification, and rollback guidance.

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
