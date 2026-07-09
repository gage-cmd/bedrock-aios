# specs/

Build specs for phases and major features live here as files, one per phase (`phase-6-something.md`). Reference them in prompts ("build Phase 6 per specs/phase-6-something.md") instead of pasting the spec into chat.

Why: pasted specs die with the session. When a session hits a usage limit mid-build, recovery from a file is one line; recovery from a pasted spec means re-pasting thousands of characters and hoping nothing drifted. Specs in git also make reversals and scope changes explicit.

If a spec arrives as a paste, save it here verbatim before starting work (the /phase skill does this automatically).
