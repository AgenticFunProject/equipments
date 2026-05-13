# Versions

Every service version bump must add or update an entry in this file.

## Unreleased

- No unreleased changes recorded yet.

## 0.1.1

- Added an Azure production deployment plan covering Container Apps, ACR, Key Vault, observability, and the recommended managed database path.
- Documented current production risks around the service's file-backed persistence options and Node runtime compatibility constraints.

## Entry Format

When the version changes, add a section like this:

```md
## 0.2.0

- Added bearer-token authentication.
- Added playground token generator.
- Added audit logging for authenticated write actions.
```
