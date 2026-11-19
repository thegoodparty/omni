# Working fast

How a coding agent (or a subagent you dispatch) should work in omni. These rules
come from measured runs: loose "read the docs first, then build X" tasks led to
100+ tool calls before a first edit, while tight tasks shipped a PR in 10 minutes.

## Rules

1. **Read the named files, in one batch.** Start from the files the task names
   (or the nearest `AGENTS.md` names). Read them in parallel in a single turn,
   not one file per call. Do not survey the repo.
2. **Make the first edit early,** within about 10 tool calls. Then let `tsc` and
   the tests tell you what is wrong. A failing type check is faster than reading.
3. **Work in steps that each end in a file change.** If a step produced no edit,
   it was exploration; stop and edit.
4. **Do not read dependency source** (`node_modules`) until `tsc` or a test
   fails and the error points there. Read only what unblocks that edit.
5. **Check the nearest `AGENTS.md` before investigating a library.** If it
   answers the question (for example `packages/gp-api/src/jobs/AGENTS.md` for
   pg-boss), treat that as settled and do not re-derive it from source.

## Dispatching a subagent

Write a tight task, not a loose one. Give it:

- the files to read and the files to change, by path;
- one existing file to imitate;
- the done condition (a passing test, an open PR).

"Read the docs first, then build X" is a loose task. Some models explore
without editing; others end the turn after one read.
