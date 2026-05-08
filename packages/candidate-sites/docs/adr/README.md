# ADRs (Architecture Decision Records)

Short, append-only records of non-obvious decisions in this repo. One file per decision, numbered sequentially (`0001-...md`, `0002-...md`).

## When to write one

Write an ADR when a decision is **load-bearing** and **non-obvious** — i.e., a future contributor (or agent) would reasonably want to change it without realizing why it was done that way. Examples worth recording:

- Why two entry routes (`app/page.tsx` + `app/[vanityPath]/page.tsx`) instead of a route group.
- Why MUI 7 **and** Tailwind 3 instead of one or the other.
- Why `helpers/fetchHelper.ts` returns `T | null` instead of throwing.
- Why `X-Robots-Tag: noindex` is global in `next.config.ts`.

Don't write one for changes that the diff itself explains (a new section component, a copy edit, a dependency bump).

## Template

Use [`ai-rules/adr-template.md`](../../ai-rules/adr-template.md) as the starting point. Copy it to `docs/adr/NNNN-short-slug.md`, fill in **Context / Decision / Consequences**, and commit it alongside the change it documents.

## Index

_(none yet)_
