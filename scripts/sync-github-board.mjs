#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const OWNER = "AgenticFunProject";
const REPO = "equipments";
const REPO_SLUG = `${OWNER}/${REPO}`;
const PROJECT_NUMBER = 3;
const APPLY = process.argv.includes("--apply");
const MANAGED_START = "<!-- beads-sync:start -->";
const MANAGED_END = "<!-- beads-sync:end -->";
const TITLE_ID_PATTERN = /\b(eq-[a-z0-9-]+)\b/i;
const BODY_ID_PATTERN = /^Bead:\s+(eq-[a-z0-9-]+)$/im;
const ACTIVE_STATUSES = new Set(["open", "in_progress", "hooked"]);
const SUPPORTED_STATUSES = new Set(["open", "in_progress", "hooked", "closed"]);
const EXCLUDED_TYPES = new Set(["epic", "molecule", "merge-request", "gate", "convoy"]);
const LEGACY_ISSUE_NUMBER_BY_BEAD = new Map([["eq-rig-equipments", 1]]);
const STATUS_NAME_BY_BEAD_STATUS = {
  open: "Todo",
  in_progress: "In Progress",
  hooked: "In Progress",
  closed: "Done"
};

function run(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function runJson(command, args) {
  const output = run(command, args);
  return JSON.parse(output);
}

function graphql(query) {
  return runJson("gh", ["api", "graphql", "-f", `query=${query}`]);
}

function mutate(query) {
  return graphql(query);
}

function patchIssue(issueNumber, fields) {
  const args = ["api", `repos/${REPO_SLUG}/issues/${issueNumber}`, "-X", "PATCH"];
  for (const [key, value] of Object.entries(fields)) {
    args.push("-f", `${key}=${value}`);
  }
  run("gh", args);
}

function cleanSummary(description = "") {
  const [, summary = ""] = description.split(/\n\n/);
  return summary.trim() || description.trim();
}

function managedBlock(bead) {
  return [
    MANAGED_START,
    `Bead: ${bead.id}`,
    `Bead Status: ${bead.status}`,
    `Bead Type: ${bead.issue_type}`,
    MANAGED_END
  ].join("\n");
}

function mergeBody(currentBody, bead) {
  const summary = cleanSummary(bead.description);
  const block = managedBlock(bead);
  const trimmed = (currentBody || "").trim();
  const withoutManaged = trimmed.replace(
    new RegExp(`${MANAGED_START}[\\s\\S]*?${MANAGED_END}`, "m"),
    ""
  ).trim();

  if (!withoutManaged) {
    return summary ? `${summary}\n\n${block}` : block;
  }

  return `${withoutManaged}\n\n${block}`;
}

function getBeadIdFromIssue(issue) {
  const bodyMatch = issue.body?.match(BODY_ID_PATTERN);
  if (bodyMatch) {
    return bodyMatch[1].toLowerCase();
  }

  const titleMatch = issue.title.match(TITLE_ID_PATTERN);
  if (titleMatch) {
    return titleMatch[1].toLowerCase();
  }

  return null;
}

function isMirrorCandidate(bead) {
  if (bead.ephemeral) {
    return false;
  }

  if (EXCLUDED_TYPES.has(bead.issue_type)) {
    return false;
  }

  if (!SUPPORTED_STATUSES.has(bead.status)) {
    return false;
  }

  return true;
}

function shouldMirror(bead, matchedIssue) {
  if (ACTIVE_STATUSES.has(bead.status)) {
    return true;
  }

  return bead.status === "closed" && Boolean(matchedIssue);
}

function desiredTitle(bead, matchedIssue) {
  if (matchedIssue && matchedIssue.number === LEGACY_ISSUE_NUMBER_BY_BEAD.get(bead.id)) {
    return matchedIssue.title;
  }

  return `[${bead.id}] ${bead.title}`;
}

function printAction(action, detail) {
  console.log(`${APPLY ? "apply" : "plan"}: ${action} ${detail}`);
}

const beadData = runJson("bd", ["list", "--all", "--flat", "--json", "-n", "0"]);
const beads = beadData.filter(isMirrorCandidate);

const repoResponse = graphql(`query {
  repository(owner: "${OWNER}", name: "${REPO}") {
    issues(first: 100, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes {
        id
        number
        title
        body
        state
      }
    }
  }
}`);

const projectResponse = graphql(`query {
  organization(login: "${OWNER}") {
    projectV2(number: ${PROJECT_NUMBER}) {
      id
      fields(first: 20) {
        nodes {
          __typename
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
      items(first: 100) {
        nodes {
          id
          content {
            __typename
            ... on Issue {
              id
              number
              title
              body
              state
              repository {
                nameWithOwner
              }
            }
          }
          fieldValues(first: 10) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`);

const repoIssues = repoResponse.data.repository.issues.nodes;
const project = projectResponse.data.organization.projectV2;
const projectId = project.id;
const statusField = project.fields.nodes.find((field) => field.name === "Status");
const statusOptionIdByName = Object.fromEntries(statusField.options.map((option) => [option.name, option.id]));
const projectItemByIssueNumber = new Map();
const issueByBeadId = new Map();

for (const issue of repoIssues) {
  const beadId = getBeadIdFromIssue(issue);
  if (beadId) {
    issueByBeadId.set(beadId, issue);
  }
}

const legacyIssue = repoIssues.find((issue) => issue.number === 1 && issue.title === "Equipments");
if (legacyIssue) {
  issueByBeadId.set("eq-rig-equipments", legacyIssue);
}

for (const item of project.items.nodes) {
  if (item.content?.__typename !== "Issue") {
    continue;
  }

  if (item.content.repository.nameWithOwner !== REPO_SLUG) {
    continue;
  }

  const statusValue = item.fieldValues.nodes.find(
    (fieldValue) => fieldValue.__typename === "ProjectV2ItemFieldSingleSelectValue" && fieldValue.field.name === "Status"
  );

  projectItemByIssueNumber.set(item.content.number, {
    itemId: item.id,
    status: statusValue?.name ?? null
  });
}

const mirroredBeadIds = new Set();
const mirroredIssueNumbers = new Set();

for (const bead of beads) {
  const matchedIssue = issueByBeadId.get(bead.id) ?? null;

  if (!shouldMirror(bead, matchedIssue)) {
    continue;
  }

  mirroredBeadIds.add(bead.id);

  let issue = matchedIssue;

  if (!issue) {
    const title = desiredTitle(bead, null);
    const body = mergeBody("", bead);
    printAction("create issue", `${title}`);

    if (APPLY) {
      const createResponse = runJson("gh", [
        "api",
        `repos/${REPO_SLUG}/issues`,
        "-f",
        `title=${title}`,
        "-f",
        `body=${body}`
      ]);
      issue = {
        id: createResponse.node_id,
        number: createResponse.number,
        title: createResponse.title,
        body: createResponse.body,
        state: createResponse.state
      };
      issueByBeadId.set(bead.id, issue);
    }
  }

  if (!issue) {
    continue;
  }

  mirroredIssueNumbers.add(issue.number);

  const nextTitle = desiredTitle(bead, issue);
  const nextBody = mergeBody(issue.body || "", bead);
  const nextState = bead.status === "closed" ? "closed" : "open";
  const needsIssuePatch = issue.title !== nextTitle || (issue.body || "") !== nextBody || issue.state.toLowerCase() !== nextState;

  if (needsIssuePatch) {
    printAction("update issue", `#${issue.number} -> state=${nextState}, title=${nextTitle}`);
    if (APPLY) {
      patchIssue(issue.number, {
        title: nextTitle,
        body: nextBody,
        state: nextState
      });
      issue.title = nextTitle;
      issue.body = nextBody;
      issue.state = nextState.toUpperCase();
    }
  }

  let projectItem = projectItemByIssueNumber.get(issue.number) ?? null;
  if (!projectItem) {
    printAction("add project item", `#${issue.number}`);
    if (APPLY) {
      const addResponse = mutate(`mutation {
        addProjectV2ItemById(input: { projectId: "${projectId}", contentId: "${issue.id}" }) {
          item {
            id
          }
        }
      }`);
      projectItem = {
        itemId: addResponse.data.addProjectV2ItemById.item.id,
        status: null
      };
      projectItemByIssueNumber.set(issue.number, projectItem);
    }
  }

  const desiredStatusName = STATUS_NAME_BY_BEAD_STATUS[bead.status];
  if (projectItem && projectItem.status !== desiredStatusName) {
    printAction("set board status", `#${issue.number} -> ${desiredStatusName}`);
    if (APPLY) {
      mutate(`mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${projectId}",
          itemId: "${projectItem.itemId}",
          fieldId: "${statusField.id}",
          value: { singleSelectOptionId: "${statusOptionIdByName[desiredStatusName]}" }
        }) {
          projectV2Item {
            id
          }
        }
      }`);
      projectItem.status = desiredStatusName;
    }
  }
}

const unmatchedIssues = repoIssues.filter((issue) => issue.number !== 1 && !mirroredIssueNumbers.has(issue.number));
if (unmatchedIssues.length > 0) {
  console.log("orphan issues:");
  for (const issue of unmatchedIssues) {
    console.log(`- #${issue.number} ${issue.title}`);
  }
}

console.log(`${APPLY ? "applied" : "planned"} sync for ${mirroredBeadIds.size} mirrored bead(s).`);
