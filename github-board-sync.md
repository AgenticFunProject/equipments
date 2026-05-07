# GitHub Board Sync Workflow

This repository mirrors active Equipments beads to GitHub issues in `AgenticFunProject/equipments` and keeps those issues on GitHub Project 3 (`Board`).

## Scope

- Mirror only top-level work beads that represent real backlog or delivery work.
- Include bead statuses `open`, `in_progress`, and `hooked`.
- Ignore infrastructure and formula artifacts such as molecules, epics, merge-request beads, gates, convoys, and ephemeral `eq-wisp-*` workflow records.
- Do not backfill every historical closed bead into GitHub. Closed beads are only synced to `Done` if they already have a matching GitHub issue.

## Canonical Mapping

- GitHub repo: `AgenticFunProject/equipments`
- GitHub Project: `AgenticFunProject` Project 3, titled `Board`
- Board Status mapping:
  - bead `open` -> `Todo`
  - bead `in_progress` or `hooked` -> `In Progress`
  - bead `closed` -> `Done`

## Duplicate Prevention

- Every mirrored issue carries a managed body block with `Bead: <id>`.
- New issues should use the title format `[eq-xyz] Bead title`.
- The sync script matches in this order:
  - existing `Bead: <id>` marker in the issue body
  - bead id already present in the issue title
  - the legacy special case `eq-rig-equipments` -> issue `#1 Equipments`

That lets the first sync claim old issues without forcing a title rename, then makes future runs idempotent.

## Existing GitHub Issues

- Keep `#1 Equipments` as the canonical mirror of `eq-rig-equipments`.
- Do not create a second umbrella issue for that bead.
- Any GitHub issue that is not matched to an active bead is reported as an orphan for manual review.
  - Today that includes `#2 Quote`.

## Operating Mode

Use a partially automated workflow.

- The repo script performs the matching, issue creation, issue updates, and board status updates.
- A human runs it manually so we do not need webhooks, long-lived credentials, or background automation in this repo.
- Default mode is a dry run so repeated audits are safe.

## Commands

Dry run:

```bash
npm run sync:github-board
```

Apply changes:

```bash
npm run sync:github-board -- --apply
```

Override the routed rig explicitly if needed:

```bash
npm run sync:github-board -- --rig equipments --apply
```

The script defaults to `--rig equipments`, so it is safe to run from the mayor checkout or any other town context that has this repo checked out. The current working directory no longer controls which beads database is mirrored.

## Expected Workflow

1. Create or update the bead in `.beads/`.
2. Run the dry run and inspect planned issue or board changes.
3. Resolve any reported orphans or intentional exceptions.
4. Re-run with `--apply`.
5. If a mirrored bead later closes, run the script again so the GitHub issue closes and the board item moves to `Done`.

For mayor-driven runs, use the same command from the mayor rig checkout:

```bash
npm run sync:github-board -- --apply
```

Because the script routes `bd list` to the Equipments rig explicitly, no manual GraphQL patching or local `.beads` database setup is required in the mayor checkout.

## Implementation Notes

- Script path: `scripts/sync-github-board.mjs`
- The script uses `bd list --rig equipments --json` as the source of truth for bead state by default.
- It uses `gh api graphql` plus `gh api repos/.../issues` to update GitHub.
- The script is safe to run repeatedly because it updates the managed `Bead:` block instead of creating a fresh issue each time.
