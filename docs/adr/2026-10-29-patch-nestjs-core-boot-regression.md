---
title: Patch @nestjs/core's DI boot regression with patch-package until upstream ships a fix
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3432']
scope:
  - patches/**
  - package.json
  - packages/gp-api/package.json
  - packages/gp-api/deploy/Dockerfile
  - .github/actions/setup-node-workspace/action.yml
---

# Patch @nestjs/core's DI boot regression with patch-package until upstream ships a fix

## Decision

gp-api runs `@nestjs/core` 11.1.27 with a local patch
(`patches/@nestjs+core+11.1.27.patch`), applied by `patch-package` from the
root `postinstall` in every install: dev machines, CI, and the production
image. The patch skips re-adding a dependency that is already recorded, stops
the dependency-tree cache reset at providers that have no cached state, walks
`lookupComponentInImports` synchronously, and reads `NEST_DEBUG` once. It
changes how fast Nest builds the provider graph, not what it resolves. Delete
the patch as soon as a Nest release we can upgrade to contains the fix.

## Context

Nest 11.1.24 (nestjs/nest#17009, the fix for #17007) made every dependency add
walk all of a provider's ancestors to clear cached scope flags. On our graph
(about 120 modules, 1,181 providers) that is about 670,000 calls per boot, and
`NestFactory.create` went from 69ms on 11.1.23 to 113ms on 11.1.27. 11.2.8 and
12.3.2 have the same code. Every `useTestService()` test file boots the app,
so this cost is paid about 320 times per CI run, and again on every ECS task
start. With the patch, Nest's own unit and integration suites pass and our
providers get the same static and durable classification as with stock Nest.

Upstream plan: a draft issue and PR for nestjs/nest (against master, with a
synthetic repro and new specs) are written but not posted. When they are, link
them here.

## Alternatives rejected

- Wait for upstream. No released version has the fix, and the cost is paid
  every boot until then.
- Pin to 11.1.23. Drops the #17007 fix (request-scoped providers silently
  treated as singletons) and every later fix.
- Monkey-patch the prototypes in a test-only setup file. Tests would run
  different DI code than production, and production boot stays slow.

## Revisit if

A Nest release includes the fix: upgrade, delete the patch, and if `patches/`
is then empty, remove `patch-package`, the `postinstall` step, the Dockerfile
`COPY patches`, and `patches/**` from the CI cache keys. Also revisit if a
request-scoped or durable provider ever resolves differently than on stock
Nest.
