# Azure Production Deployment

This repo does not ship a full Azure platform stack, but it now includes the service-side scaffolding needed to deploy `equipments-service` to Azure Container Apps against PostgreSQL instead of SQLite.

Files in this directory:

- `containerapp.postgres.yaml`: production Container App template with PostgreSQL runtime storage, Key Vault secret references, `/health` probes, and conservative replica defaults
- `containerapp-job.migrate.postgres.yaml`: one-off migration job template that runs `npm run migrate` before switching traffic to a new service revision

## Production Defaults

- `STORAGE_BACKEND=postgres`
- `STORAGE_POSTGRES_URL` comes from Azure Key Vault, not inline YAML values
- `/health` is used for startup, readiness, and liveness probes on port `3000`
- `minReplicas: 2` keeps one replica available during restarts and revision rollouts
- `activeRevisionsMode: Single` avoids split traffic across incompatible runtime configs during normal deploys

## Required Secrets

Create these secrets in Azure Key Vault before deploying:

- `storage-postgres-url`: PostgreSQL connection string for the production database
- `auth-jwt-secret`: production HS256 bearer-token signing secret shared by Users Service and Equipments

The Container App and migration job both use system-assigned managed identity. Grant that identity Key Vault secret read access before running either template.

## JWT Configuration With Users Service

Production admin bearer tokens come from Users Service `POST /auth/token`. Equipments validates those JWTs locally, so the Container App configuration must share the same JWT contract as the Users Service runtime configuration:

- Users Service and Equipments must use the same `AUTH_JWT_ISSUER`; it must equal the token `iss`
- Users Service and Equipments must use the same `AUTH_JWT_AUDIENCE`; it must equal the token `aud`
- Users Service and Equipments must use the same `AUTH_JWT_SECRET`; in production this must be resolved from the secret manager, such as Azure Key Vault, and never copied into inline Container App configuration

The Azure templates set `AUTH_JWT_SECRET` from the Key Vault-backed `auth-jwt-secret` secret reference and include placeholder issuer and audience values. Change those values in both the service app and migration job templates whenever the production Users Service issuer or audience differs from the defaults.

Expected production admin tokens are HS256 JWTs with `sub` set to a stable Users Service `users.id`, matching `iss` and `aud`, a future `exp`, a `scope` claim, and `role` set exactly to `admin`. Non-admin tokens still require `equipments:read` for read routes and `equipments:modify` for write routes.

## Build And Push

Build the repo and publish an image tag before applying the templates:

```bash
npm run build
npm test

docker build -t <registry>.azurecr.io/equipments-service:<image-tag> .
docker push <registry>.azurecr.io/equipments-service:<image-tag>
```

The repo includes a production `Dockerfile` based on `node:22-bookworm-slim` that builds `dist/` and starts the service with `node dist/src/index.js`. The matching `npm run migrate` script also targets `dist/src/persistence/migrate.js`, so the migration job runs against the same compiled runtime layout as the service container.

## Deploy Workflow

1. Fill in the placeholder values in both YAML files.
2. Apply or update the migration job.
3. Run the migration job against PostgreSQL.
4. Apply or update the service revision.
5. Verify health, revision state, and logs before considering the rollout complete.

Example commands:

```bash
az containerapp job create \
  --resource-group <resource-group> \
  --yaml azure/containerapp-job.migrate.postgres.yaml

az containerapp job start \
  --resource-group <resource-group> \
  --name equipments-migrate

az containerapp create \
  --resource-group <resource-group> \
  --yaml azure/containerapp.postgres.yaml
```

For updates, use the matching `update` commands instead of `create`.

## Migration-Before-Start Expectation

`src/index.ts` validates the PostgreSQL schema before the HTTP server begins listening. That means a new revision will fail startup if the database has not already been migrated to the expected schema version.

Deployments should therefore follow this order every time:

1. Push the new image.
2. Run `npm run migrate` through the Container Apps job.
3. Roll the service revision to the same image tag.

Do not rely on app startup to apply schema changes.

## Verification Checklist

Run these checks after each rollout. The JWT checks must use an admin token minted by the production Users Service and call both one Equipments read endpoint and one Equipments write endpoint.

The write-route JWT check below uses a synthetic event type so it validates authorization without changing catalogue or reservation state; it still creates a normal audit event.

```bash
az containerapp revision list \
  --resource-group <resource-group> \
  --name equipments-service \
  --output table

az containerapp show \
  --resource-group <resource-group> \
  --name equipments-service \
  --query properties.configuration.ingress.fqdn \
  --output tsv

curl -fsS https://<fqdn>/health

TOKEN=$(curl -fsS -X POST https://<users-service-fqdn>/auth/token \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8").toString()).token')

curl -fsS https://<fqdn>/equipment-types \
  -H "Authorization: Bearer $TOKEN"

VALIDATION_CODE="AZVAL$(date +%s)"
curl -fsS -X POST https://<fqdn>/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"eventType\":\"jwt.validation\",\"payload\":{\"bookingReference\":\"$VALIDATION_CODE\"}}"

az containerapp logs show \
  --resource-group <resource-group> \
  --name equipments-service \
  --follow false
```

Successful rollout signals:

- migration job exits successfully
- at least two replicas become ready
- `GET /health` returns `200` with the expected version
- Users Service admin token validates against both a read route and a write route
- logs do not show schema version or secret resolution failures

## Rollback Guidance

1. If the new revision is unhealthy before serving traffic, disable it and keep the previous revision active.
2. If the new revision already depends on a newer schema, do not assume an older image can safely start against that database state.
3. For backward-incompatible schema changes, prefer a forward fix or restore the database from backup before reactivating an older revision.

In practice:

- keep PostgreSQL backups aligned with each production rollout
- treat schema migrations and app revisions as a coordinated unit
- only use traffic rollback alone when the migrated schema remains compatible with the previous image
