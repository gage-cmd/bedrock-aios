---
name: phase
description: Start or finish a bedrock-aios build phase safely. Use when the user says "start phase N", "continue phase N", "phase done", or pastes a phase build spec. Prevents redoing completed phases, running phases out of order, and losing state to session limits.
---

# Phase workflow

## Starting or continuing a phase (`/phase start N`, `/phase continue N`, or a pasted phase spec)

1. Read `PROJECT-STATE.md` and run `git log --oneline -15` and `git status`.
2. Cross-check: if the requested phase (or any of its steps) is already marked complete or has a matching commit, STOP and tell the user exactly what is already done, with commit hashes. Do not redo it. This has happened before (a completed Phase 3 was re-requested from a stale prompt).
3. If the working tree is dirty, report what is uncommitted before making any edit — a prior interrupted session may have left half-applied changes.
4. If the phase depends on an earlier phase that is not complete, say so before building (phases have been fed out of order before).
5. Find the spec: prefer `specs/phase-N*.md`. If the user pasted a spec instead, save it to `specs/` first (verbatim), then work from the file — this makes recovery after a session limit a one-line prompt instead of a re-paste.
6. Build step by step. Commit at each completed step with a descriptive message. If a step needs a manual action from the user (Supabase dashboard, Vercel, credentials), say so explicitly and wait — do not fake it with a migration or stub silently.

## Finishing a phase (`/phase done`)

1. Verify per CLAUDE.md rules: full test suite, plus a 1-record live verification against the demo tenant or real endpoint. Green units alone are not done.
2. Confirm no test rows remain in the live DB.
3. Update `PROJECT-STATE.md`: mark the phase complete with the commit hash and date; add any new open items or manual steps discovered.
4. Commit (ledger update included) and push. If push fails on credentials, say so plainly and list the stranded commits.
5. Summarize: what shipped, what was verified and how, what remains manual.
