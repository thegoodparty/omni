'use client'

import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { turfsQueryOptions } from './turfQueries'

// Which surface this page is: a candidate's Win rail or an elected official's
// Serve one. Door knocking has ONE route for both, so unlike social and phone
// banking — where the Serve caller is a different page passing a `surface`
// prop — there is nowhere to put the answer except a context.
//
// It is decided once, by the page, from the same predicate
// `DoorKnockingPageGate` uses to grant access at all: a Campaign takes
// precedence, and an ElectedOffice is consulted only in its absence. An org
// mid-transition therefore keeps its Win rail, which is the safer of the two
// wrong answers — its existing lists stay visible — and it matches what
// gp-api's `POST /v1/door-knocking/turfs` does with the same question, so a
// list is always created onto the rail that is showing.
//
// Defaulting to Win rather than throwing on a missing provider: every consumer
// below is also mounted by the print route and by tests, and a rail that reads
// the Win endpoint is what all of those already expect.
const DoorKnockingSurfaceContext = createContext(false)

export const DoorKnockingSurfaceProvider = DoorKnockingSurfaceContext.Provider

export const useDoorKnockingServeMode = () =>
  useContext(DoorKnockingSurfaceContext)

// The rail, for the surface being drawn. Every reader goes through this rather
// than calling `turfsQueryOptions` with its own idea of the mode — four
// components read this list and a disagreement between any two of them is two
// rails on one screen.
export const useTurfsQuery = () =>
  useQuery(turfsQueryOptions(useDoorKnockingServeMode()))
