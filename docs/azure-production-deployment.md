# Azure Production Deployment Plan

This document describes the recommended production deployment path for the `equipments-service` on Azure. It assumes Azure Container Apps for compute, Azure Container Registry (ACR) for images, Azure Key Vault for secrets, and Azure Monitor/Application Insights for observability.

## Recommended Target Architecture

- Build a production image for the Fastify service and publish it to ACR.
- Run the service in Azure Container Apps with ingress enabled only for the API entrypoint.
- Store configuration secrets in Azure Key Vault and inject them into the container app through managed identity.
- Send logs, metrics, and traces to Azure Monitor/Application Insights.
- Use a managed relational database as the long-term production data store.

Recommended production topology:

1. Azure Container Registry hosts versioned service images.
2. Azure Container Apps runs at least two replicas across zones where available.
3. Azure Key Vault stores auth secrets and database credentials.
4. Azure Monitor/Application Insights collects request telemetry, container logs, and alerts.
5. Azure Database for PostgreSQL Flexible Server is the preferred managed production database target after the application adds a compatible persistence adapter.

## Why This Path

- Azure Container Apps fits the current single-service Node deployment model and supports revision-based rollouts.
- ACR, Key Vault, and managed identity remove the need to embed runtime secrets in images or CI variables.
- Azure Monitor gives a straightforward path to HTTP availability alerts, error-rate alerts, and container diagnostics.
- A managed relational database is a safer production fit than the current file-backed persistence modes.

## Current Codebase Constraints

The current application is not yet production-ready for a managed database deployment without additional implementation work.

- Persistence backends currently supported by the code are `memory`, JSON-file (`STORAGE_BACKEND=db`), and SQLite (`STORAGE_BACKEND=sqlite`).
- There is no PostgreSQL, MySQL, or other managed relational database adapter in the codebase today.
- The SQLite implementation uses `node:sqlite`, so the production image should use a Node runtime that supports that module even though `package.json` currently declares `"node": ">=20"`.
- The service is stateful today. Running multiple replicas safely requires a shared persistence strategy that is not based on local container filesystem state.
- Authentication is based on a shared HS256 secret (`AUTH_JWT_SECRET`), so secret rotation and issuer control need operational discipline until a stronger platform identity integration is implemented.

## Prerequisites

- Azure subscription with permission to create networking, ACR, Container Apps, Key Vault, and monitoring resources.
- A CI pipeline that can build the image, run `npm run build` and `npm test`, and push to ACR.
- A production container image based on a Node runtime compatible with the service's current persistence implementation.
- Managed identity enabled for the Container App.
- Private or tightly restricted network access between the app and its backing data store.
- A decision on the production persistence phase:
  1. Preferred: implement a managed relational database adapter before go-live.
  2. Transitional only: run SQLite on mounted durable storage with the expectation of single-writer limitations and reduced resilience.

## Required Environment Variables

Minimum runtime configuration for the current codebase:

- `PORT`: Container Apps can pass this explicitly; defaults to `3000`.
- `HOST`: keep `0.0.0.0`.
- `NODE_ENV=production`
- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`
- `AUTH_JWT_SECRET`
- `STORAGE_BACKEND`

Additional variables for the currently implemented persistence modes:

- For JSON-file persistence:
  - `STORAGE_BACKEND=db`
  - `STORAGE_DB_PATH`
- For SQLite persistence:
  - `STORAGE_BACKEND=sqlite`
  - `STORAGE_SQLITE_PATH` or `STORAGE_DB_PATH`
  - `STORAGE_SQLITE_EMPTY_ON_FIRST_BOOT=false`

Future managed database variables should be introduced when a new adapter is added. For example, a PostgreSQL-backed implementation would likely need host, port, database name, user, password, TLS mode, and pool settings.

## Deployment Steps

## 1. Build and publish the image

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm test`.
4. Build a production image.
5. Push the image to ACR with an immutable tag such as the git SHA and service version.

## 2. Provision Azure base infrastructure

1. Create or select a resource group.
2. Create ACR.
3. Create a Log Analytics workspace and Application Insights instance.
4. Create a Key Vault.
5. Create a Container Apps environment.
6. Create the target database service.

## 3. Configure secrets and identity

1. Enable a system-assigned or user-assigned managed identity on the Container App.
2. Grant that identity `get` access to the required Key Vault secrets.
3. Store `AUTH_JWT_SECRET` and any database credentials in Key Vault.
4. Configure the Container App to read secret values from Key Vault references rather than inline literals.

## 4. Deploy the Container App

1. Configure the image from ACR.
2. Set CPU and memory based on expected API load.
3. Configure min replicas greater than zero for production.
4. Configure readiness and liveness checks against `GET /health`.
5. Set ingress, TLS, and any IP restrictions required by the environment.
6. Inject the runtime environment variables listed above.
7. Send logs and metrics to Azure Monitor/Application Insights.

## 5. Validate the deployment

1. Confirm the revision starts and answers `GET /health`.
2. Verify authenticated reads and writes using production-equivalent JWT settings.
3. Confirm the service is using the intended persistence backend.
4. Confirm dev-only endpoints are unavailable in production.
5. Check telemetry, dashboards, and alerts before promoting traffic fully.

## Managed Production Database Path

Recommended long-term direction:

1. Add a new persistence adapter for Azure Database for PostgreSQL Flexible Server.
2. Move state from file-backed storage into relational tables managed outside the container lifecycle.
3. Add migration tooling separate from request-serving startup.
4. Validate concurrent replica safety before scaling out Container Apps horizontally.

This is the preferred production path because it removes dependence on container-local or mounted filesystem state and aligns better with multi-replica failover.

## Transitional Option

If the service must be deployed before the managed database adapter exists, the least-disruptive short-term option is SQLite with durable mounted storage.

- Treat this as transitional, not the final production architecture.
- Keep a single active writer replica unless the application is proven safe under SQLite locking behavior.
- Plan backup, restore, and corruption recovery procedures around the mounted database file.
- Expect operational friction compared with a managed relational database.

## Operational Considerations

- Run at least two warm replicas only after the persistence layer supports safe concurrent access.
- Use revision-based rollouts and keep rollback images available in ACR.
- Alert on health check failures, high 5xx rates, restarts, and auth failures.
- Retain container stdout/stderr logs and HTTP telemetry long enough to investigate booking and inventory incidents.
- Back up the production database on a schedule that matches recovery objectives.
- Document token secret rotation because the service currently validates symmetric JWTs.
- Lock down public exposure of the playground and confirm production mode hides dev-only controls.

## Risks And Gaps

- No managed database adapter exists yet, so the recommended target architecture is ahead of the current implementation.
- The current file-backed persistence model is a poor fit for resilient multi-replica production deployments.
- The SQLite implementation depends on `node:sqlite`, which creates a runtime compatibility constraint that is stricter than the current engine declaration in `package.json`.
- The service currently performs persistence directly inside application request flows, so large-scale operational behavior under production traffic is still unproven.
- Authentication currently depends on a shared secret rather than federated key discovery or managed identity-based service auth.

## Recommended Next Work Before Go-Live

1. Implement a managed relational database adapter, preferably PostgreSQL.
2. Align `package.json` engine requirements with the real production Node version requirement.
3. Add infrastructure-as-code for Container Apps, ACR, Key Vault, monitoring, and the production database.
4. Add production runbooks for rollback, secret rotation, backup/restore, and incident response.
