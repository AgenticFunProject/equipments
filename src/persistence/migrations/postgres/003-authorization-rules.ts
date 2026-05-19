import { createSeedAuthorizationRules } from "../../../authorization-rules.js";
import type { PostgresMigrationContext } from "../../migration-context.js";

export async function up({ context }: { context: PostgresMigrationContext }): Promise<void> {
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS authorization_rules (
      route_key text PRIMARY KEY CHECK (route_key <> ''),
      method text NOT NULL CHECK (method <> ''),
      path_pattern text NOT NULL CHECK (path_pattern <> ''),
      controller text NOT NULL CHECK (controller <> ''),
      action text NOT NULL CHECK (action <> ''),
      resource_type text NOT NULL CHECK (resource_type <> ''),
      required_scope text,
      admin_accepted boolean NOT NULL,
      is_public boolean NOT NULL,
      created_at text NOT NULL CHECK (created_at <> ''),
      updated_at text NOT NULL CHECK (updated_at <> ''),
      UNIQUE (method, path_pattern)
    )
  `);
  await context.client.query(`
    CREATE INDEX IF NOT EXISTS idx_authorization_rules_resource
      ON authorization_rules (resource_type, method)
  `);

  for (const rule of createSeedAuthorizationRules()) {
    await context.client.query(
      `INSERT INTO authorization_rules (
        route_key,
        method,
        path_pattern,
        controller,
        action,
        resource_type,
        required_scope,
        admin_accepted,
        is_public,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (route_key) DO NOTHING`,
      [
        rule.routeKey,
        rule.method,
        rule.pathPattern,
        rule.controller,
        rule.action,
        rule.resourceType,
        rule.requiredScope,
        rule.adminAccepted,
        rule.public,
        rule.createdAt,
        rule.updatedAt
      ]
    );
  }
}
