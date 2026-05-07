# Best Practices For New Gas Town Projects

This guide captures the default operating rules we should copy into new projects unless there is a clear reason to do something different.

## Goal

Start with a project shape that is easy to reason about, easy to review, and easy for the mayor to delegate safely.

## Default Coding Standards

- Prefer small, focused changes over broad refactors.
- Match the existing language, framework, and naming conventions before introducing new patterns.
- Keep code and tests readable without extra abstraction layers.
- Add comments only when the intent is not obvious from the code itself.
- Use ASCII by default unless the file already depends on Unicode content.
- Fail fast on invalid input and return explicit errors instead of silent fallbacks.
- Do not introduce backward-compatibility code unless the project has a real external consumer or persisted data that requires it.
- Keep secrets out of the repo. Configuration belongs in environment variables or other approved runtime configuration.

## Architecture Rules

- Keep the domain model and business rules in plain modules, not buried in transport or framework code.
- Keep I/O at the edges. HTTP handlers, CLI commands, and persistence adapters should stay thin.
- Prefer explicit data contracts over implicit shape passing.
- Make side effects easy to find. A reader should quickly see where data is read, written, or sent elsewhere.
- Separate dev-only helpers from production behavior.
- Add new dependencies only when they clearly reduce complexity or replace code we should not maintain ourselves.
- Choose one obvious place for each concern: routing, domain logic, persistence, tests, and docs.

## Ticket Workflow

- Every repo change starts with a beads ticket before implementation begins.
- The ticket should state the user-visible goal, constraints, and what "done" means.
- Keep one branch focused on one ticket or one tightly related slice of work.
- Persist findings back to the bead while working so analysis survives session loss.
- File newly discovered work as a separate bead instead of quietly expanding scope.
- Use small commits with clear intent.
- Run the project build and relevant tests before handing work off.
- If the change is user-visible, bump the project version and update the release notes document for that repo.
- Do not mark work complete until the branch is clean and the required verification has passed.

## Mayor Delegation Rules

- The mayor should delegate outcomes, constraints, and ownership, not low-level implementation details unless they are critical.
- Each bead should have one directly responsible owner at a time.
- Split work into child beads when tasks can proceed independently or need different specialists.
- Keep delegated work concrete enough that the assignee can start without a planning meeting.
- Put blockers, assumptions, and acceptance criteria in the bead so the next agent can recover context quickly.
- Escalate to the witness or mayor when requirements are unclear, access is missing, or retries are not converging.
- Do not reassign unrelated cleanup to a worker already carrying delivery risk on another bead.

## Suggested Definition Of Done

- The implementation is complete and scoped to the ticket.
- Docs and version notes are updated when the change affects users or teammates.
- Build and test commands pass locally.
- The branch is clean, commits are present, and the handoff or completion signal includes enough context for the next step.

## Project Setup Checklist

- Add a README that explains purpose, boundaries, and local run commands.
- Document the default build, test, and release commands in one obvious place.
- Define where architecture decisions, release notes, and demo flows will live.
- Make the ticket and release workflow explicit from day one.
- Keep the first version boring and operable before adding clever abstractions.
