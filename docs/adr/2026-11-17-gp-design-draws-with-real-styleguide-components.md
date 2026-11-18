---
title: gp-design prototypes render the real styleguide components, never a hand copy
status: active
decided_by: [eugenebazdyriev]
date: 2026-11-17
code: ['#3865']
scope:
  - .claude/skills/gp-design/**
supersedes: []
superseded_by:
---

# gp-design prototypes render the real styleguide components, never a hand copy

## Decision

A gp-design prototype is a TSX flow file that imports the components from
`packages/styleguide`, bundled with esbuild and styled by gp-webapp's own
`app/globals.css`. The phone is a 375 x 812 element on the page, not an
iframe; the build turns width media queries into container queries on it and
stands in for what reads the window (`useIsMobile`, portals, scroll lock).
Desktop preview is the same flow at full width. No CSS copy of a component
(like `ux-review-options/assets/gp-ui.css`) is used to draw a gp-design page.

## Context

A prototype showed a link button turning solid blue on hover. The cause was
`gp-ui.css`, a hand copy of the styleguide that gave every button the primary
hover. Nothing compared the copy with `button.tsx`, and the senior review
judges screenshots, so the drift shipped in every prototype. Any hand copy
drifts this way, and so does a desktop drawn separately from the phone.

`ux-review-options` has its own owner and still draws with `gp-ui.css`, so
gp-design keeps its own copy of that pipeline rather than changing it.

## Alternatives rejected

- Fix `gp-ui.css`: fixes one hover and leaves every other block free to drift.
- Real components in an iframe: exact, but Vercel comments can't reach
  elements inside it, so reviewers lose comments on the design.
- Static markup rendered at build time: no hover, focus, open overlays or
  tabs, which is what the review missed.
- Build the prototype in gp-webapp: total fidelity, but a branch and preview
  deploy per run.

## Revisit if

A one-design mode that builds in gp-webapp as a PR lands, or
`ux-review-options` moves to the real components and the two pipelines merge.
