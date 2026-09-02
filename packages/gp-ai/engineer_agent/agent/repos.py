"""What the agent needs to know to work in each repo it is allowed to touch.

WHY THIS EXISTS: until now the agent knew exactly one repo, and it knew it as a
paragraph of English in the capability prompt. That was honest while omni was the
only place bugs could be fixed. Marketing bugs land in a different repo
(`thegoodparty/gp-marketing`), so the repo stopped being a constant.

DIVISION OF LABOUR, and it matters for where a change belongs:

  - The LAMBDA decides WHICH repo a ticket belongs to, from the ClickUp list the
    ticket sits in, and passes it as `TARGET_REPO` (see REPO_BY_LIST_ID in
    clickup_bot/lambda/handler.py). List ids are ClickUp's business and the
    Lambda is the only thing holding them.
  - THIS FILE says HOW to work in a repo once chosen: where to clone from, what
    branch a PR targets, which package manager, how to verify a change, and what
    is likely to go wrong. None of that is ClickUp's business.

Nothing is duplicated between the two, so neither has to be kept in step with the
other — a new repo needs one entry in each, answering two different questions.

The per-task instruction templates in the Lambda stay deliberately repo-neutral
for the same reason. Repo identity belongs here.
"""

from dataclasses import dataclass

OMNI = "thegoodparty/omni"
MARKETING = "thegoodparty/gp-marketing"


@dataclass(frozen=True)
class RepoProfile:
    full_name: str
    base_branch: str
    # The prose handed to the model. Kept as a block per repo rather than
    # assembled from fields because it is a briefing, not a config: the parts
    # that matter most (how this repo fails) do not fit in a schema.
    briefing: str


OMNI_BRIEFING = f"""Product code lives in the **{OMNI}** monorepo (default branch `main`):
```bash
git clone --depth 1 https://x-access-token:$GITHUB_TOKEN@github.com/thegoodparty/omni.git /workspace/omni
```
Packages live under `packages/`: gp-webapp, gp-api, election-api,
gp-admin, candidate-sites, gp-sdk, contracts, gp-ai. Open PRs against omni's `main`.

Your own code (this agent, the ClickUp bot) lives in omni at `packages/gp-ai` —
it is NOT a separate repo.

Verification steps are per-package: each package's `AGENTS.md` has a "Verify"
section listing its own lint / type-check / test commands. Run the ones for the
package you touched.

The old standalone repos (gp-webapp, gp-api, people-api, election-api,
gp-ai-projects) are **archived** (read-only) — never clone them and never open a
PR against them. gp-data-platform remains a separate live repo:
```bash
git clone --depth 1 https://x-access-token:$GITHUB_TOKEN@github.com/thegoodparty/gp-data-platform.git /workspace/gp-data-platform
```"""


# Written from a survey of the repo rather than from assumption. The hazards
# section is the important half: this repo's failure mode is not a red build, it
# is a green one that shipped nothing.
MARKETING_BRIEFING = f"""The GoodParty marketing website lives in the **{MARKETING}** repo
(default branch `develop`, NOT `main`). It is a public repo:
```bash
git clone --depth 1 --recurse-submodules https://x-access-token:$GITHUB_TOKEN@github.com/thegoodparty/gp-marketing.git /workspace/gp-marketing
```
Clone WITH submodules: `ai-rules/` is a submodule and CI runs a check out of it.

Single Next.js 15 App Router app (React 19, TypeScript, Tailwind 4) — NOT a
monorepo, so there is one root `package.json` and no `packages/` directory.
Read the root `AGENTS.md` first; `CLAUDE.md` is a symlink to the same file.
Open PRs against **`develop`**.

**Bun, not npm.** The version is pinned (`bun@1.2.23`) and CI installs with
`bun install --frozen-lockfile`. Reaching for npm or yarn produces a lockfile
that fails CI.

Verify a change with all three, the same gates CI runs:
```bash
bun install --frozen-lockfile
bun run typecheck && bun run lint && bun run test
```

## WHAT GOES WRONG HERE

**A green build does not mean the bug is fixed.** A broken block renders as
nothing: unknown block types log a console warning and render empty, and an
error boundary swallows render errors. A half-wired component passes every check
and shows up only as a missing section on the live site. For any change that
affects rendering, say in the PR description exactly which page and section a
human should open in the Vercel preview to confirm it. Do not claim a rendering
fix is verified because CI is green.

**You cannot run `next build` here.** It needs Sanity and Vercel secrets you do
not have, and it type-checks Next's generated route and layout types that
`bun run typecheck` does not. A change to a `page.tsx` or `layout.tsx` signature
can pass locally and still fail the Vercel build, which runs on the PR. Expect
that feedback after pushing, not before.

**Many bugs reported against this site are not code.** Copy, images, links,
colors and block ordering are Sanity CMS content, edited in the Studio, with no
code cause and no code fix — read `docs/content-vs-code.md` before concluding
there is a defect. Candidate and election DATA problems belong to election-api /
gp-api, not here. If the report is content or data, say so and do not write code.

**Never open, edit or regenerate `sanity.types.ts`.** It is a generated 15 MB
file, committed to the repo. Reading it will bury your context; regenerating it
produces an unreviewable diff.

Leave `.github/workflows/rotate-election-api-token.yml` alone — it rotates a
production credential on a schedule."""


REPO_PROFILES = {
    OMNI: RepoProfile(full_name=OMNI, base_branch="main", briefing=OMNI_BRIEFING),
    MARKETING: RepoProfile(full_name=MARKETING, base_branch="develop", briefing=MARKETING_BRIEFING),
}

DEFAULT_REPO = OMNI


class UnknownRepoError(ValueError):
    """A repo was named that this agent has no briefing for."""


def resolve_repo(name: str | None) -> RepoProfile:
    """The profile for `name`, defaulting to omni when nothing was asked for.

    UNSET AND UNKNOWN ARE TREATED DIFFERENTLY, deliberately.

    Unset means nobody is routing yet — a local invocation, a task definition
    from before multi-repo, a script. Defaulting to omni keeps every one of
    those working exactly as it did.

    Unknown means something DID route, and named a repo this agent cannot brief
    the model about. Falling back to omni there would point a marketing ticket
    at the monorepo and produce a confident analysis of the wrong codebase —
    the failure that is hardest to spot, because it looks like work. Raising
    fails the run instead, which is loud and cheap to diagnose.
    """
    if name is None or not name.strip():
        return REPO_PROFILES[DEFAULT_REPO]
    profile = REPO_PROFILES.get(name.strip())
    if profile is None:
        raise UnknownRepoError(f"No repo profile for {name!r}; known repos: {sorted(REPO_PROFILES)}")
    return profile
