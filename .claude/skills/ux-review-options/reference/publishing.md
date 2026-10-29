# Publishing to artifacts.goodparty.org

One Vercel project, `artifacts`, on the good-party team. Each artifact is
`https://<slug>.artifacts.goodparty.org`, an alias that points at one deployment.
Every publish is a new preview deployment, so the deployment list is the version
history. Viewing needs a Good Party Vercel sign-in (Viewer seat). Reviewers comment
with the Vercel toolbar.

`scripts/publish.sh <folder> <slug>` does all of this. The rules behind it:

- **Auth.** `VERCEL_TOKEN` is in the environment. Never print, log or publish it.
  Use the Vercel CLI (`npx -y vercel@latest ... --token "$VERCEL_TOKEN" --scope
  good-party`), never hand-built API calls.
- **Project.** Export `VERCEL_ORG_ID=team_e4HAh1NYJW4yYc38qx66yTtG` and
  `VERCEL_PROJECT_ID=prj_mZyNcY3dqoIihryPvjp9rCdrf2TY` before any deploy, or Vercel
  creates a new project.
- **Slug.** Lowercase letters, digits and hyphens, 63 characters at most, one level
  (`ux-86akf3ex5`). Same slug on a rerun replaces the artifact's alias.
- **Never** deploy with `--prod`, and never link the bare `artifacts.goodparty.org`
  (it has no certificate). Share the slug link, not the raw deployment URL.
- **Static files only.** No server code. Root-relative paths work.
- **No real data.** No voter, constituent or CRM data. Use the fixtures.

## Comments

Reviewers leave comments with the Vercel toolbar. Read them with the CLI:

```
npx -y vercel@latest comments ls --project artifacts --all-branches --json \
  --token "$VERCEL_TOKEN" --scope good-party
```

Add `--status all` for resolved threads. Keep threads whose `context.href` host is
`<slug>.artifacts.goodparty.org`. Reply with `vercel comments reply <threadId>
--project artifacts --message "..."`. Resolve a thread only after the change is
published. Never delete or edit a person's comment.

Comments record the CSS selector of the element they pin to, so give blocks stable,
readable ids (`#option-a`, `#a-save`).

## Access

Someone who can't open the link asks Swain to add their goodparty.org email as a
Viewer. Don't suggest approving an access request.
