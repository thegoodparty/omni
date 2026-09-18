---
name: claude-design-read
description: Read a Claude Design file in full, without silent truncation. Use when you need the source of a design from claude.ai/design — a .dc.html, a token file, a component — to implement it, scope it, or diff it against the product. Necessary because DesignSync.get_file caps every read at 256 KiB and reports success while truncating.
argument-hint: <claude-design-url-or-project-id> [file path]
allowed-tools: Bash Read Glob Grep
---

Fetch the design file at $ARGUMENTS and report what you got.

## Why this skill exists

**`DesignSync.get_file` caps a read at 256 KiB and reports success while
truncating it.** There is no error. A real design comes back as roughly its first
third, syntactically plausible, and an agent that does not check the `truncated`
flag will implement against it confidently. Measured on a 7,900-line design: the
wrapper returned about a third of the file and **none** of the flow the feature
was about.

The cap is per-READ, not per-file. The underlying MCP tool is `read_file`, which
takes `offset` and `limit`, so the file can be paged and reassembled. The wrapper
does not expose those parameters, so the script calls the endpoint directly.

## Steps

**1. Refresh auth.** The design token is short-lived. Make any DesignSync call and
the stored credential refreshes itself:

```
DesignSync(method="get_project", projectId="<project_id>")
```

This also confirms the project exists and is readable. Note `list_projects` will
**not** show a regular design project — it only lists design systems — so address
the project by id.

If it says authorization is needed, the user runs `/design-login` once. That is
the only case the script cannot recover from on its own.

**2. Fetch.**

```bash
python3 .claude/skills/claude-design-read/scripts/fetch_design.py \
  <project_id> "<file path>" <out_file>
```

Both arguments come straight out of the design URL:
`claude.ai/design/p/<project_id>?file=<path>`

Run it from the repo root. Write the output under `scratch/` — it is gitignored,
and a design file is several hundred KB.

**3. Check what you got.** The script prints the byte and line count and verifies
the assembled line count against the server's own total. It exits non-zero rather
than hand back anything partial. If it reports `[OK]`, the file is complete.

## What to do with it

The file is a `.dc.html`: a `<script type="text/x-dc" data-dc-script>` block of
`React.createElement` calls composing the bound design system, with tokens
referenced as CSS custom properties (`var(--color-primary)`). So it is readable
source, not a rendered artifact — the component names, props, copy, layout values
and conditional logic are all in there.

Two things worth knowing before reading one:

- **A design file usually holds several features.** Grep for the one you want
  rather than assuming the file is about it.
- **Sample data and specification look identical.** Both are literals in the same
  file. A contradiction between a fixture row and a live constant is a prototype
  artifact, not a bug in the product.

To list what a project contains, `DesignSync(method="list_files", projectId=…)`
works fine — the cap only bites on file contents.

## Known limits

- **A single line of 256 KiB or more cannot be retrieved.** It is cut mid-line and
  a line-count check cannot see it, so the script checks separately and raises.
  This affects minified bundles, including the `(standalone).html` export. Authored
  `.dc.html` source has normal lines and pages fine.
- **The script calls the MCP endpoint directly**, using the credential
  `/design-login` stores. It depends on `read_file` keeping its current shape.
  If `DesignSync.get_file` ever gains `offset`/`limit`, use that instead and
  delete this.
