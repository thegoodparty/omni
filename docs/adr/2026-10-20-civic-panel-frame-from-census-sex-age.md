---
title: The priority read's frame takes age, sex and tract margins from the census, not the voter file
status: active
decided_by: [samuelgoodparty]
date: 2026-10-20
code: ['#PR']
scope:
  - packages/gp-api/src/priorities/util/censusFrame.util.ts
  - packages/gp-api/src/priorities/services/censusComposition.ts
  - packages/gp-api/src/priorities/util/mrpReadStatus.util.ts
supersedes: []
superseded_by:
---

# The priority read's frame takes age, sex and tract margins from the census, not the voter file

## Decision

The multilevel model of a priority's answers is poststratified to a frame
whose age band, sex and tract margins are the census's adults (ACS B01001
sex by age band, and adults per tract), not the voter file's counts. The
voter file seeds the cells, so how the dimensions overlap, the unknowns and
race stay as they were. The same frame sets the major groups (the 3% rule),
`districtAnswersNeeded` and the read status, so the groups named on screen
are the groups the model has. Where the census figure is suppressed or
missing, that dimension keeps the voter file's counts and the read logs it.

Samuel (`samuelgoodparty`), who owns the model, decided to poststratify to
census sex by age; Bryan (`bryclevgp`) relayed it on 2026-10-20.

## Context

Census sex by age (B01001) reached the Serve district and block group
marts in prod. The model reweighted to registered or matched people, whose
age and sex mix differs from the adults who live in the district, and the
steering and round 2 frame already read the census.

## Alternatives rejected

- **Keep the voter file frame.** Misses adults the file under-covers, and
  disagrees with the census the steering reads.
- **A pure census product frame, as round 2 builds.** Drops the voter
  file's overlap of age, sex, tract and race.
- **Census race too.** The census counts race over everyone, children
  included, with no age split, so race stays with the voter file.

## Revisit if

The marts publish joint tract by age by sex counts worth fitting to, or
the voter file's race stops being a usable source.
