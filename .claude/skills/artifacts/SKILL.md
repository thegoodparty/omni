---
name: artifacts
description: Publish an HTML artifact (a prototype, wireframe, mockup, report, chart or any page people should open and comment on) to a private https://<slug>.artifacts.goodparty.org link on Vercel, and read and answer reviewers' comments on it. Use when someone asks for an artifact or a page to share and hasn't asked for a Claude artifact, or when a Claude artifact won't work - you are Delegate or another agent without a person's Claude session, or another agent has to read the result.
---

Publish a static page that GoodParty staff can open, click through and comment on,
and that any agent with Vercel access can read back, comments included.

## Why not a Claude artifact

A Claude artifact can only be read by the person who made it, inside Claude. Delegate
can't open one, an agent can't read its comments, and nobody can build from it
without downloading it by hand. These pages sit behind Good Party's Vercel sign-in
instead: people review them in a browser, and agents fetch the page and its
comments with the Vercel CLI. If someone asks for a Claude artifact by name, make
that instead.

## How it works

- One Vercel project, `artifacts`, on the good-party team.
- Each artifact lives at `https://<slug>.artifacts.goodparty.org`, which points at
  one deployment.
- Every publish is a new deployment with its own permanent URL, so the deployment
  list is the version history. Republishing moves the slug; old versions keep
  their URLs.
- Viewing needs a sign-in on the Good Party Vercel team (a free Viewer seat).
  Reviewers comment with the Vercel toolbar on the page.

## Access

- **Delegate:** `VERCEL_TOKEN` is in the environment (bot account `delegate-gp`).
  Never print it, log it or put it in a file you publish. `publish.sh` picks it
  up on its own; add `--token "$VERCEL_TOKEN"` to every `vercel` command you
  run yourself.
- **A person's agent:** run `npx vercel login` once with your goodparty.org account.
  The commands below then work without a token.
- Always use the Vercel CLI (`npx -y vercel@latest ...`) with `--scope good-party`,
  never hand-built API calls.

## Build the page

- A folder with an `index.html`. Static files only: HTML, CSS, JS and images, no
  build step, no server code. Root-relative paths (`/style.css`) work, because each
  artifact is the root of its own subdomain.
- No real voter, constituent or CRM data, ever, even behind sign-in. Use the
  fixtures in `docs/design-memory/fixtures.md`, example.com emails and 555 phone
  numbers.
- Put content directly in the page, never in an iframe. The comment toolbar can't
  see inside one, so a pin there only records the iframe.
- Give important blocks and controls stable, readable ids (`#option-a`, `#a-save`).
  A comment records the CSS selector it is pinned to, and good ids tell you exactly
  what the reviewer meant. Comments also record the page path, so one page per view
  is fine.
- Build it in a scratch folder outside the repo. This repo is public, and the page
  often holds ticket text or meeting notes.

## Publish

```sh
.claude/skills/artifacts/scripts/publish.sh <folder> <slug>
```

It deploys, points the slug at the new deployment, checks the page loads, and
prints the link to share.

- **Slug:** lowercase letters, digits and hyphens, 63 characters at most, one
  level (`a.b.artifacts.goodparty.org` won't work). Name it so a person knows
  what it is from the link alone: `serve-priorities`, `import-contacts-options`.
  Never a ticket id.
- **Never take over someone else's slug.** The script refuses a slug that already
  exists. To publish a new version of your own artifact, pass `--update`.
- **Never deploy with `--prod`,** and never link the bare `artifacts.goodparty.org`:
  it is a placeholder with no certificate.
- **Share the slug link,** not the raw deployment URL.

Each deploy is tagged with its slug. To list an artifact's versions, or to see the
page the way a reviewer does:

```sh
npx -y vercel@latest list artifacts --meta artifact=<slug> --scope good-party
npx -y vercel@latest curl / --deployment https://<slug>.artifacts.goodparty.org --scope good-party
```

## Read and answer comments

All artifacts share one project, so the comment list covers every artifact.

```sh
npx -y vercel@latest comments ls --project artifacts --all-branches --json --scope good-party
```

- Add `--status all` to include resolved threads, and `--page-path '/options.html'`
  to filter by page.
- Each thread has `context.href` (the page URL, host included), `context.selector`
  (the element it is pinned to), `deploymentId` (the version reviewed) and
  `messages`.
- Keep threads whose `context.href` host is `<slug>.artifacts.goodparty.org`, and
  threads whose `deploymentId` is one of the artifact's versions: a reviewer can
  comment on an old version's raw URL. If it isn't the current version, check
  whether you already addressed it.

```sh
npx -y vercel@latest comments reply <threadId> --project artifacts --message "<short reply>" --scope good-party
npx -y vercel@latest comments resolve <threadId> --project artifacts --scope good-party
```

- Reply when you have acted on a comment: say what changed and which version has
  it. Resolve only once that version is published.
- If a comment is unclear, ask in the thread.
- Never delete or edit a person's comment. Only people can start threads.

## When a reviewer can't get in

A Vercel login page or a "request access" screen means they aren't on the Good
Party Vercel team yet. Tell them to ask Swain to add their goodparty.org email as a
Viewer. Don't suggest approving the access request: it covers one artifact, and
they'd hit it again on the next one.
