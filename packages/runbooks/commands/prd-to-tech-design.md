<!-- v2 — 2026-05-04 -->
# /prd-to-tech-design

Take a PRD or product spec plus the **set of repos** the work touches, scan each codebase, surface architecture options with tradeoffs, and produce a **tech design doc** that engineering can review and bless **before** tasks are created. The output ships as both a local markdown file *and* a published page in ClickUp under the PRD (so product/eng reviewers see it in the same place they read the PRD), accompanied by a `.drawio.xml` data flow diagram. This sits between the PRD (what/why) and `/clickup-epic-create` (how, broken into tickets).

Use this for any non-trivial feature where the technical approach isn't already settled. For small interface tweaks or follow-up tasks within an existing Epic, skip this and go directly to `/clickup-epic-create` with whatever doc you have.

GoodParty has many repos (`gp-api`, `gp-admin`, `gp-webapp`, `gp-sdk`, `gp-ai-projects`, `election-api`, `people-api`, `tgp-api`, etc.) — most non-trivial features touch more than one. The command asks up front which repos are involved and recons each.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_TEAM_ID`, `$CLICKUP_DRAFTS_DIR`, `$CLICKUP_DESIGNS_DIR`, `$CLICKUP_REPOS_DIR`, `$CLICKUP_EDITOR`
**scripts/.env variables**: `CLICKUP_API_KEY` (only used in Phase 8 to publish — the rest of the procedure is offline)
**Tools**: `git`, `ripgrep` (`rg`), the user's editor of choice. The `.drawio.xml` file is plain XML — no draw.io binary required to generate; users open it in [diagrams.net](https://app.diagrams.net) or the VS Code "Draw.io Integration" extension.

Defaults if a `books/.env` value is unset: `$CLICKUP_DRAFTS_DIR=$HOME/.claude/drafts/clickup`, `$CLICKUP_DESIGNS_DIR=$HOME/.claude/designs/clickup`, `$CLICKUP_REPOS_DIR=$HOME/.claude/repos`, `$CLICKUP_EDITOR=code`.

## Steps

User input may be passed as free-text initial context (e.g., `~/docs/auth-prd.md gp-api,gp-webapp`), `resume` to list staged drafts, or `resume <slug>` to resume a specific draft (partial match OK). Treat that input as `$ARGUMENTS` below.

### Phase 0: Check for staged drafts

1. **If `$ARGUMENTS` starts with `resume`:**
   - List `*-tech-design.draft.md` files under `$CLICKUP_DRAFTS_DIR`.
   - If a slug was given, match against filenames (partial match OK).
   - If multiple matches or no slug, show a table of available drafts (slug, title, staged date — pulled from frontmatter) and ask which to load.
   - Read the chosen draft (and the companion `.drawio.xml` if present).
   - **Skip to Phase 7 (review loop)** with the loaded content.
   - If no staged drafts exist, say so and proceed to Phase 1.

### Phase 1: Read the PRD

2. **Get the PRD.** From `$ARGUMENTS` or by asking. Accept any of:
   - **Local file path** → read it.
   - **URL** → fetch it via web fetch tools, or `curl` for Confluence/Notion exports the user has access to.
   - **Pasted text** → use as-is.

   Confirm in 2–3 sentences: "Here's what I think this PRD is asking for: [problem, target users, headline goal, key non-goals, any milestones / dated phases]. Did I get that right?". Don't proceed until the user confirms.

3. **Identify the ClickUp publish target.** The blessed tech design will be published as a page under the PRD in ClickUp so reviewers see it next to the source. Ask the user for the PRD's location in ClickUp (or accept a flag for "external / no ClickUp"):

   - **ClickUp Doc** (most common — PRDs typically live as Docs) — paste the URL or doc ID. URL formats:
     - Doc home: `https://app.clickup.com/<workspace>/v/dc/<doc_id>` → use `<doc_id>` as the parent doc; the tech design will be a top-level page in that doc.
     - Specific page: `https://app.clickup.com/<workspace>/v/dc/<doc_id>/<page_id>` → tech design will be a child page under `<page_id>`.
   - **ClickUp Task** — paste the task ID/URL (`https://app.clickup.com/t/<task_id>`). The tech design will be created as a subtask titled "Tech Design: <title>" with the markdown body.
   - **External / skip publish** — user just wants the local file (e.g., the PRD lives in Notion/Confluence, or they'll paste it in manually). Skip Phase 8's publish step.

   Capture the choice — `$PUBLISH_MODE` ∈ `{doc, task, skip}` — plus the relevant IDs (`$PUBLISH_DOC_ID`, `$PUBLISH_PARENT_PAGE_ID`, `$PUBLISH_TASK_ID`). Keep these in working memory for Phase 8.

4. **Verify this is actually a PRD, not a tech design.** If the input is already a tech design (names components, data model, libraries, file paths, prescribes architecture), stop and tell the user: "This already reads like a tech design — feed it directly into `/clickup-epic-create` instead. I'd just be paraphrasing." Offer to proceed if they want a second-opinion architecture review.

5. **Pin down what the PRD does NOT decide.** Surface the technical-decision space the PRD is silent on. Typical gaps:
   - Data model: new tables/columns vs. extending existing? Foreign keys? Soft-delete vs. hard?
   - Auth/permissions: does this need new roles/scopes, or fit existing ones?
   - Sync vs. async: is the user waiting on this, or does it run in background?
   - State storage: in-memory, DB, cache, queue?
   - Migration story: backfill needed? Feature-flagged rollout?
   - External services: new third-party integration, or existing?
   - Performance/scale: expected QPS, data volume, latency targets?
   - Failure / DR: what's the blast radius if this breaks? Data loss tolerance? Recovery path?

   Don't ask the user about these yet — these are the questions the tech design will answer.

   **Also extract, in the same pass: milestones the PRD _does_ specify.** PRDs commonly phase delivery — words like "Phase 1 / Phase 2", "MVP", "V1 / V2", "by end of Q3", or explicit dated checkpoints. Capture each as a `{name, dueDate, scope}` triple — these carry through to the tech design's Milestones section and ultimately to the ClickUp Epic via `/clickup-epic-create`. If the PRD has no milestones, note that and move on; **don't manufacture them**.

### Phase 2: Codebase reconnaissance (multi-repo)

6. **Ask which repos are involved.** Don't assume — most non-trivial GoodParty features touch more than one repo:

   > Which repos does this implementation touch? (comma- or newline-separated; can be repo names like `gp-api,gp-webapp`, local paths, or GitHub URLs)

   Common combinations to remind the user about:
   - **API + DB change + admin UI** → `gp-api` + `gp-admin`
   - **Public-facing feature** → `gp-api` + `gp-webapp`
   - **Shared types** → `gp-api` + `gp-sdk` + (consumer like `gp-admin` or `gp-webapp`)
   - **Election/voter data** → `election-api` or `people-api` + the consuming app
   - **Cross-cutting** → frequently three or more

   For each named repo, resolve a local path:
   - **Repo name only** (e.g., `gp-api`) → look under `$CLICKUP_REPOS_DIR/<name>` and the user's typical clone location (e.g., `~/Documents/gp/dev/<name>`). Confirm the path before scanning.
   - **Local path** → use directly.
   - **GitHub URL** → clone shallowly:
     ```bash
     mkdir -p "$CLICKUP_REPOS_DIR"
     [ -d "$CLICKUP_REPOS_DIR/<name>" ] \
       && (cd "$CLICKUP_REPOS_DIR/<name>" && git pull --ff-only) \
       || git clone --depth 50 <url> "$CLICKUP_REPOS_DIR/<name>"
     ```

   Track the resolved set as `$REPOS` — a list of `{name, path, role}` triples. The `role` is a one-line description of what this repo contributes ("public web frontend", "REST API", "shared SDK", "voter data backend"). Confirm the list with the user before scanning.

7. **Map the PRD to each codebase.** Run targeted recon per repo, not whole-codebase scans. For each repo in `$REPOS`:

   ```bash
   # Per-repo lay of the land
   ls "$REPO_PATH"
   cat "$REPO_PATH/README.md" 2>/dev/null | head -60

   # Detect language/framework
   ls "$REPO_PATH" | grep -E '^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|build\.gradle)$'

   # Test framework
   rg -n --no-heading -g '!node_modules' '(jest|vitest|pytest|rspec|go test|cargo test)' "$REPO_PATH" | head -10

   # Each PRD concept against this specific repo
   rg -n --no-heading -g '!node_modules' '<concept>' "$REPO_PATH" | head -20
   ```

   For each repo, capture:
   - **Existing patterns to extend** — modules where similar features already live
   - **Architectural seam** — where new code naturally lands in *this* repo (controllers, services, models, components, hooks)
   - **Cross-cutting infrastructure** — auth middleware, feature flags, queue/job runners, ORM conventions
   - **Test infrastructure** — how *this* repo tests similar concerns
   - **Pain points to avoid** — deprecated dirs, `// TODO: replace this` patterns

   The goal is a per-repo footprint, not a single global summary — different repos may need different patterns and that's OK.

8. **Briefly summarize what you learned to the user**, structured per repo:
   ```
   gp-api (REST API):  language Node/TS, tests via vitest, similar feature lives in src/users/, auth via passport JWT
   gp-admin (admin UI): React/Next.js, tests via jest, similar admin views in app/dashboard/, auth via cookie session
   gp-sdk (shared types): tsup build, Zod schemas, follow contracts → SDK re-export pattern
   ```
   This catches misunderstandings before option-generation.

### Phase 3: Architecture options

9. **Generate 2–3 distinct architecture options.** This is the load-bearing step — the whole reason this command exists. Each option should differ in a *meaningful* way (not "use service X vs service Y" — that's bikeshedding; "do this synchronously in the request path vs. queue and process async" — that's a real choice).

   Don't manufacture options. If there's clearly only one reasonable approach (e.g., a CRUD addition to an existing well-patterned area), say so explicitly: "I considered alternatives but they all amount to the same thing — proceeding with one approach." Then describe just that one. Inventing fake alternatives wastes the human reviewer's time and dilutes trust in the recommendation.

   For each option, capture:
   - **Approach (1–2 sentences)** — the headline of how it works
   - **Repos affected** — which of `$REPOS` change under this option, and how
   - **What gets reused** — existing modules/patterns this leans on
   - **What gets built new** — new code, new infra, new dependencies
   - **Tradeoffs** — what this is good at, what it's bad at
   - **Complexity** — rough sense (small / medium / large), with the cost driver
   - **Risks** — failure modes, things that could go wrong in production
   - **Who pays the long-term tax** — operational burden, on-call load, future flexibility

10. **Recommend an approach** with explicit reasoning. The recommendation isn't "the safest" or "the simplest" by default — it's the one that best matches the PRD's actual constraints and the team's posture. Be willing to recommend the harder option if it earns its keep.

### Phase 4: Cross-cutting concerns and open questions

11. **Walk the cross-cutting list and capture decisions per concern.** Don't skip any of these even if the answer is "N/A" — saying "no auth changes needed" is a real signal. Four of these are **required sections in the final document** and must be answered concretely:

    **Required (always):**
    - **Inputs and Outputs** — what data flows in (HTTP requests, queue messages, file uploads, user actions) and what flows out (responses, side effects, events emitted, persisted state). Be specific about shapes/contracts.
    - **DB Changes** — exact tables/columns added or modified, indexes, migrations, foreign keys, constraints. If no DB change, say "no DB change" explicitly with why.
    - **Disaster Recovery** — what does failure look like? Blast radius? RPO/RTO if applicable. How do we recover from each failure mode (DB corruption, queue backlog, external API outage, deploy rollback)?
    - **Data Flow Diagram** — see Phase 6; this section in the markdown links to the `.drawio.xml` file.

    **Other concerns (answer if applicable):**
    - **Migration / rollout** — backfill, feature flag, staged rollout, dual-write
    - **Auth / permissions** — new roles, scope changes, audit logging
    - **API surface** — new endpoints, breaking changes to existing, deprecation plan
    - **Sync vs. async** — request-path latency budget, queue/job choices, retry semantics
    - **External dependencies** — new third-party services, API limits, fallback behavior
    - **Observability** — metrics, logs, traces, alerts, dashboards
    - **Performance** — expected load, caching strategy, hot-path concerns
    - **Security** — input validation, secrets handling, PII boundaries

12. **List open questions** — things the tech design *can't* resolve without input from outside engineering (product on edge cases, legal/compliance on data retention, security on threat model, design on UX of error states). Flag who needs to weigh in.

### Phase 5: Draft the tech design doc

13. **Generate a slug** from the PRD's working title. Lowercase, hyphenate, strip non-alphanumerics, truncate to 50 chars. Confirm with the user: "Slug `<slug>` for the design files — OK?". Then check `$CLICKUP_DRAFTS_DIR` for an existing `<slug>-tech-design.draft.md`; if found, ask whether to resume that or pick a more specific slug.

14. **Draft the tech design** as `$CLICKUP_DRAFTS_DIR/<slug>-tech-design.draft.md`:

    ````markdown
    ---
    type: tech-design
    slug: <slug>
    title: <Working title>
    prdSource: <path or URL>
    publishMode: <doc | task | skip>
    publishDocId: <id or empty>
    publishParentPageId: <id or empty>
    publishTaskId: <id or empty>
    repos:
      - { name: <name>, path: <local path>, role: <one-line> }
      - { name: <name>, path: <local path>, role: <one-line> }
    milestones:
      - { name: "<M1 short name>", dueDate: "<YYYY-MM-DD or empty>", scope: "<one-line>" }
      - { name: "<M2 short name>", dueDate: "<YYYY-MM-DD or empty>", scope: "<one-line>" }
    dataFlowDiagram: <slug>-data-flow.drawio.xml
    staged: <YYYY-MM-DD>
    status: draft
    ---

    # Tech Design: <Title>

    ## Problem
    Restate the problem in your own words. One paragraph. If you can't write this, you don't understand the PRD yet.

    ## Goals
    - Concrete, testable outcomes (carry over from the PRD; rephrase if needed for clarity).

    ## Non-Goals
    - Things explicitly out of scope. If the PRD didn't say "out of scope" but you're treating it as such, say why.

    ## Milestones
    Carry forward from the PRD if it specified phasing or dated checkpoints. If the PRD did not specify milestones, write **"No milestones in source PRD."** and move on — don't invent them here.

    | Milestone | Due | Scope |
    |-----------|-----|-------|
    | M1: <name> | <YYYY-MM-DD or "TBD"> | <one-line of what this milestone delivers> |
    | M2: <name> | ... | ... |

    ## Constraints
    - Budget, deadline, team capacity, infra/platform limits, regulatory.
    - Things you can't change (existing data model, auth scheme, etc.).

    ## Repos in Scope
    | Repo | Role | Notes |
    |------|------|-------|
    | <name> | <role> | <relevant existing modules/patterns> |
    | <name> | <role> | ... |

    ## Codebase Context (per repo)
    For each repo, the relevant existing modules, patterns, and infrastructure this design leans on. Be specific — file paths and module names — so reviewers don't have to re-derive what you already learned.

    ### <repo-name>
    - ...

    ### <repo-name>
    - ...

    ## Architecture Options Considered

    ### Option A: <name>
    - **Approach:** ...
    - **Repos affected:** ...
    - **What gets reused:** ...
    - **What gets built new:** ...
    - **Tradeoffs:** ...
    - **Complexity:** small / medium / large — driver: ...
    - **Risks:** ...

    ### Option B: <name>
    [same fields]

    ### Option C: <name>  (optional — only if there's a real third option)
    [same fields]

    ## Recommendation: Option <X>
    State explicitly which option and *why*. Not "this is safest" — what about the constraints/posture above makes this the right call?

    ## Detailed Design
    The recommended approach, fleshed out:
    - Component breakdown per repo
    - Sequence/flow for the main user-facing path
    - Error handling per layer

    ## Inputs and Outputs
    Required section. Be concrete:

    **Inputs:**
    - HTTP requests (method, path, payload shape) | queue messages (topic, schema) | file uploads | user actions
    - Trust boundaries: which inputs are user-controlled vs. internal-only

    **Outputs:**
    - HTTP responses (status, body shape) | events emitted | persisted state | side effects on external systems
    - Side-effect ordering: what's idempotent, what isn't

    ## DB Changes
    Required section. Be concrete — copy-paste-runnable schema, not vague description:

    ```sql
    -- New table:
    CREATE TABLE ... (...);
    -- New index:
    CREATE INDEX ... ON ... (...);
    -- Modified column:
    ALTER TABLE ... ADD COLUMN ...;
    ```

    Or, if no DB change: **"No DB change. <why — e.g., this feature reads existing tables only.>"**

    ## Data Flow Diagram
    See `<slug>-data-flow.drawio.xml` (sibling file, generated by Phase 6). Open in [diagrams.net](https://app.diagrams.net) or VS Code's Draw.io Integration extension.

    Summary in prose: <one paragraph describing the flow shown in the diagram — actors, services, data crossing trust boundaries, where state lives>.

    ## Disaster Recovery
    Required section. Walk each meaningful failure mode:

    | Failure mode | Blast radius | Detection | Recovery |
    |--------------|--------------|-----------|----------|
    | DB primary down | ... | ... | ... |
    | External API outage | ... | ... | ... |
    | Bad deploy | ... | ... | ... |
    | Queue backlog | ... | ... | ... |

    Include RPO/RTO targets if data is critical. If this feature is read-only and stateless, say so — "feature degrades to read-only with cached data; no DR concerns beyond app-level"  is a valid answer.

    ## Cross-Cutting Concerns
    | Concern | Decision |
    |---------|----------|
    | Migration / rollout | ... |
    | Auth / permissions | ... |
    | API surface | ... |
    | Sync vs. async | ... |
    | External dependencies | ... |
    | Observability | ... |
    | Performance | ... |
    | Security | ... |

    ## Open Questions
    - [ ] Question 1 — needs input from <who>
    - [ ] Question 2 — needs input from <who>

    ## Out of Scope (deliberately deferred)
    - Things we considered and chose not to do *now*, with the reason. Future-Epic candidates.

    ## Risks and Mitigations
    | Risk | Likelihood | Impact | Mitigation |
    |------|------------|--------|------------|

    ## Estimated Effort
    Rough sense per repo: small / medium / large, with the major cost drivers. Not a commitment — a directional read for prioritization.
    ````

    Quality bar — before generating the diagram (Phase 6), self-check:
    - **Real, not invented.** Every file path, module name, and pattern reference is from the actual repo scan, not pattern-matched from training data.
    - **Honest about uncertainty.** Open questions are flagged explicitly, not papered over with confident-sounding guesses.
    - **The recommendation has reasoning, not just a vote.** "We chose B because X" — where X is something a reviewer can argue with.
    - **Options are real.** If they all collapse to the same architecture, just describe one and say so.
    - **Required sections are populated, not stub.** Inputs/Outputs, DB Changes, and Disaster Recovery each have concrete content, even if "N/A" with a reason.
    - **Repos in Scope matches what was confirmed in step 6.** No phantom repos that didn't get scanned.
    - **Milestones preserved.** Every milestone the PRD specified is in the Milestones section with its due date and scope, and mirrored in the `milestones:` frontmatter array. If the PRD specified none, both the section and the frontmatter say so explicitly (`milestones: []`) — empty/missing without comment is a smell.

### Phase 6: Generate the data flow diagram

15. **Write the data flow diagram** to `$CLICKUP_DRAFTS_DIR/<slug>-data-flow.drawio.xml`. The file is plain XML in the [draw.io / diagrams.net format](https://www.drawio.com/doc/faq/save-file-formats). Build it from the architecture you just described — boxes for each actor/service/component (one per repo plus external systems), labeled arrows for each data flow, grouping where it clarifies the picture (e.g., a "GoodParty platform" container around the in-house repos, with external services outside).

    Skeleton template — fill in actual nodes and edges from your design:

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <mxfile host="app.diagrams.net" modified="<ISO timestamp>" agent="prd-to-tech-design" version="22.0.0">
      <diagram id="data-flow" name="Data Flow">
        <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">
          <root>
            <mxCell id="0" />
            <mxCell id="1" parent="0" />

            <!-- One mxCell per node. Example: -->
            <mxCell id="user" value="User" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
              <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />
            </mxCell>

            <mxCell id="webapp" value="gp-webapp&#10;(Next.js frontend)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
              <mxGeometry x="220" y="40" width="160" height="60" as="geometry" />
            </mxCell>

            <mxCell id="api" value="gp-api&#10;(REST API)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
              <mxGeometry x="440" y="40" width="160" height="60" as="geometry" />
            </mxCell>

            <mxCell id="db" value="Postgres" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
              <mxGeometry x="660" y="40" width="100" height="80" as="geometry" />
            </mxCell>

            <!-- One mxCell per edge. Example: -->
            <mxCell id="e1" style="endArrow=classic;html=1;rounded=0;" edge="1" parent="1" source="user" target="webapp">
              <mxGeometry relative="1" as="geometry" />
              <mxCell value="HTTP form submit" style="edgeLabel;" vertex="1" connectable="0" parent="e1">
                <mxGeometry x="-0.1" relative="1" as="geometry">
                  <mxPoint as="offset" />
                </mxGeometry>
              </mxCell>
            </mxCell>

            <!-- ... more nodes and edges ... -->

          </root>
        </mxGraphModel>
      </diagram>
    </mxfile>
    ```

    Conventions:
    - **Color by trust boundary** — internal (in-house) repos one color (green), external services another (blue), users another (light blue), data stores yellow/cylinder.
    - **Label every edge** with what's flowing — "HTTP POST /campaigns", "DB row inserted", "queue message: voter.imported".
    - **One diagram per design** — multiple diagrams (e.g., happy-path + failure-path) bloat the deliverable; reviewers want one canonical picture. If the design genuinely needs two, add a second `<diagram>` element inside the same `<mxfile>` (draw.io supports multi-page).
    - **Position is rough** — draw.io's auto-layout will tidy if needed. Don't waste time on pixel-perfect coordinates; reviewers will reposition.
    - **Only show what's load-bearing** — don't draw every internal class; show services, data stores, queues, external APIs, and the user. The detailed component breakdown lives in the markdown.

    Sanity-check the XML before opening the editor: it should parse as valid XML, have at least one `<mxCell vertex="1">` per repo in `$REPOS`, and have edges connecting them. If the diagram has fewer nodes than `$REPOS`, that's a smell — you missed a service.

### Phase 7: Review loop

16. **Open both files in the editor:**
    ```bash
    "$CLICKUP_EDITOR" \
      "$CLICKUP_DRAFTS_DIR/<slug>-tech-design.draft.md" \
      "$CLICKUP_DRAFTS_DIR/<slug>-data-flow.drawio.xml"
    ```

17. **Tell the user what's open and present options:**

    > Drafted tech design at `$CLICKUP_DRAFTS_DIR/<slug>-tech-design.draft.md` and data flow diagram at `<slug>-data-flow.drawio.xml`. Edit either directly — the .drawio.xml renders graphically in VS Code with the Draw.io Integration extension or in [diagrams.net](https://app.diagrams.net). When ready:
    >
    > - **`good`** — finalize, save to `$CLICKUP_DESIGNS_DIR/`, and publish to ClickUp
    > - **`edit`** — tell me what to change (I'll update either file)
    > - **`investigate`** — dig deeper before finalizing (re-scan a repo, fetch related docs, look at similar past Epics)
    > - **`stage`** — save and resume later via `resume <slug>`
    > - **`abandon`** — discard both drafts

18. **If `edit`:** apply changes to whichever file(s). For diagram edits, modify the XML directly — add/remove `<mxCell>` elements and edges as the user describes the change. Loop back to step 17.

19. **If `investigate`:** ask what to dig into. Common useful moves:
    - Re-scan a specific repo for missed details.
    - Search a repo's PR history for prior similar work: `gh pr list --search "<query>" --repo <owner/repo>`.
    - Pull architectural notes from related blessed tech designs in `$CLICKUP_DESIGNS_DIR`.
    - Fetch product/legal docs the user references.
    Update the markdown and/or the diagram based on findings, then loop back to step 17.

20. **If `stage`:** confirm "Staged as `<slug>`. Resume with `resume <slug>`." and **stop**.

21. **If `abandon`:** confirm with the user, then `rm` both draft files.

22. **If `good`:** **re-read both draft files from disk** before finalizing — the user may have edited them directly.

### Phase 8: Save, publish, and hand off

23. **Save the blessed tech design and diagram** to `$CLICKUP_DESIGNS_DIR/`:
    ```bash
    mkdir -p "$CLICKUP_DESIGNS_DIR"
    cp "$CLICKUP_DRAFTS_DIR/<slug>-tech-design.draft.md" "$CLICKUP_DESIGNS_DIR/<slug>-tech-design.md"
    cp "$CLICKUP_DRAFTS_DIR/<slug>-data-flow.drawio.xml" "$CLICKUP_DESIGNS_DIR/<slug>-data-flow.drawio.xml"
    ```
    Update the markdown's frontmatter:
    - `status: draft` → `status: blessed`
    - Add `blessedAt: <YYYY-MM-DD>`
    - (After step 24, also add `clickupPublishUrl: <url>`.)

24. **Publish to ClickUp** based on `$PUBLISH_MODE`. Build payloads via `python3 -c '...'` writing to a temp `.json` file (markdown bodies contain quotes/backticks; never template into a JSON literal). The `.drawio.xml` is **not** uploaded — link to it from the page body via the local repo path or a checked-in copy if your team versions design assets in git.

    **`$PUBLISH_MODE = doc`** — create a page in the existing PRD doc:
    ```bash
    # Build payload:
    # /tmp/page.json: {"name": "Tech Design: <title>", "content": "<markdown>", "content_format": "text/md", "parent_page_id": "<id>"}
    # If publishing as a top-level page in the doc, OMIT the `parent_page_id` key entirely
    # — do not set it to null or "" (ClickUp will 400). Build the dict in Python and only
    # add `parent_page_id` when $PUBLISH_PARENT_PAGE_ID is non-empty.
    cd scripts/python && uv run clickup_api.py --api-version=v3 \
      POST workspaces/$CLICKUP_TEAM_ID/docs/$PUBLISH_DOC_ID/pages \
      @/tmp/page.json
    ```
    Capture the returned `id` and construct the URL: `https://app.clickup.com/<team>/v/dc/<doc_id>/<page_id>`.

    **`$PUBLISH_MODE = task`** — create a subtask under the PRD task. Use `clickup_api.py` v2 (default):
    ```bash
    # /tmp/subtask.json: {"name": "Tech Design: <title>", "markdown_description": "<markdown>", "parent": "$PUBLISH_TASK_ID"}
    # The list_id required for POST: fetch from the parent task first.
    cd scripts/python && uv run clickup_api.py GET task/$PUBLISH_TASK_ID
    # Read .list.id from the response; pass it to the next call:
    cd scripts/python && uv run clickup_api.py POST list/<list_id>/task @/tmp/subtask.json
    ```
    Capture the returned `id` and construct: `https://app.clickup.com/t/<task_id>`.

    **`$PUBLISH_MODE = skip`** — don't publish; the local file is the deliverable. Skip to step 25.

    Strip the YAML frontmatter from the markdown body before publishing — reviewers don't need the bookkeeping.

    On any publish failure: log the error, keep the local files, **do not** retry blindly. Surface to the user with the error body so they can fix permissions/IDs and re-run with `resume <slug>` (which will re-publish).

25. **Clean up the staged drafts:**
    ```bash
    rm "$CLICKUP_DRAFTS_DIR/<slug>-tech-design.draft.md"
    rm "$CLICKUP_DRAFTS_DIR/<slug>-data-flow.drawio.xml"
    ```
    Only run this if Phase 8's publish (or skip) succeeded. If it failed, leave the drafts so the user can resume.

26. **Report.**
    - Tech design saved at `$CLICKUP_DESIGNS_DIR/<slug>-tech-design.md`
    - Data flow diagram at `$CLICKUP_DESIGNS_DIR/<slug>-data-flow.drawio.xml`
    - Recommended approach: <Option X>
    - Repos in scope: <list>
    - Milestones carried forward: <count> (or "none — PRD didn't specify any")
    - ClickUp page URL (if published): <url>
    - Open questions to resolve before tasks are created: <count> (or "none")
    - Suggested next steps:
      - **If open questions remain:** "Share the ClickUp page with [the people listed in Open Questions] for resolution before breaking down into tasks."
      - **If ready for breakdown:** "Run `/clickup-epic-create` with the saved tech design as input."

## Important Notes

- **Tech designs are for humans first.** Format for skim-readability — tables, headers, short paragraphs. A tech design no one reads is dead weight.
- **Recommendation, not menu.** Don't just list options and let the reviewer pick — make a recommendation with reasoning. Reviewers can argue with reasoning; they can't argue with a shrug.
- **Don't manufacture options.** Two options that are 95% the same isn't two options. One real option > three fake ones.
- **Open questions are first-class.** A tech design with unresolved open questions is fine — the bless cycle is meant to surface those. A tech design that hides open questions to look complete is worse than useless.
- **The four required sections (Inputs/Outputs, DB Changes, Data Flow Diagram, Disaster Recovery) are non-negotiable.** "N/A with a reason" is a valid answer; absent or stub content is not. These are the things reviewers consistently ask about, baked into the template so they're never an afterthought.
- **Multi-repo is the default, not the exception.** Always ask which repos; never assume one. Per-repo recon avoids "the API change broke the admin UI because we didn't look there" surprises.
- **`.drawio.xml` is the diagram source of truth.** Don't paste a screenshot into the markdown — the XML stays editable forever; screenshots rot.
- **Not every feature needs this command.** Small interface changes, follow-up tasks within an existing blessed Epic, bug fixes — go directly to `/clickup-epic-create`. This command is for new features where architecture isn't already decided.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| The "PRD" is actually a tech design | Stop the procedure, redirect to `/clickup-epic-create`. Don't write a tech design *of* a tech design. |
| Codebase scan overruns context (huge monorepo) | Do staged per-repo recon — scan one repo at a time, summarize into the per-repo Codebase Context section, then drop the raw scan from working memory. Or `stage` early and resume. |
| Can't find any reasonable architecture options | The PRD probably has gaps. Surface them as open questions and stop — don't invent options to fill silence. |
| User says "all options sound the same" | They probably are. Collapse to one; say so explicitly. Better to look honest than to look thorough. |
| Open Questions list keeps growing during drafting | Good signal — surface and bless before tasks. A tech design with 8 unresolved opens isn't a tech design, it's a question list; route to product/legal/security accordingly. |
| `.drawio.xml` doesn't render in diagrams.net | XML probably isn't valid. Re-emit; if it parses but is empty in the viewer, the `mxGeometry` coordinates may all be 0,0 — spread vertices out (e.g., `x` increments of 200). |
| ClickUp page POST returns 404 on `/docs/<id>/pages` | The doc ID was wrong. Doc IDs come from the URL segment after `/dc/` — they're typically prefixed with characters that look like a hash. Re-fetch the URL from the user. |
| ClickUp page POST returns 401 but other v2 calls work | The v3 Docs API requires a workspace-level token; ensure the API token belongs to a user with at least Member access on the workspace, not just guest access on a specific List. |
| Subtask creation under a PRD task fails on `parent` | The `list_id` in the POST URL must match the PRD task's list. Fetch the task first, copy `.list.id`, then post the subtask there. |
| Want to re-publish after editing the local file | Re-run with `resume <slug>` — the resumed flow re-reads the local file and re-publishes. Or, for a one-off, build the v3 page-update payload and PUT to `workspaces/<wid>/docs/<did>/pages/<pid>`. |
