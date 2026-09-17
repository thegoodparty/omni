import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_DOOR_KNOCKING_FLAG_KEY } from '@shared/experiments/nativeDoorKnockingFlag'

const { redirect, getFlagVariants } = vi.hoisted(() => ({
  redirect: vi.fn(),
  getFlagVariants: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@shared/experiments/getFlagVariants', () => ({ getFlagVariants }))

import DoorKnockingSurveysLayout from './layout'

const children = <div>designer</div>

describe('door-knocking surveys layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The designer writes to eCanvasser, so its questions are never asked at a
  // native knock — a pilot tester who lands here authors a script that goes
  // nowhere, next to the DoorScript the walk actually shows.
  it('sends a pilot user back to the door-knocking map', async () => {
    getFlagVariants.mockResolvedValue({
      [NATIVE_DOOR_KNOCKING_FLAG_KEY]: { value: 'on' },
    })

    await DoorKnockingSurveysLayout({ children })

    expect(redirect).toHaveBeenCalledWith('/dashboard/door-knocking')
  })

  // Control is the production experience for everyone outside the pilot, tabs
  // and all, so an off (or unassigned) flag has to change nothing.
  it('leaves the legacy designer alone for control', async () => {
    getFlagVariants.mockResolvedValue({
      [NATIVE_DOOR_KNOCKING_FLAG_KEY]: { value: 'off' },
    })

    await DoorKnockingSurveysLayout({ children })

    expect(redirect).not.toHaveBeenCalled()
  })

  it('leaves it alone when no flag is assigned', async () => {
    getFlagVariants.mockResolvedValue({})

    await DoorKnockingSurveysLayout({ children })

    expect(redirect).not.toHaveBeenCalled()
  })

  // getFlagVariants answers null for an anonymous request or a gp-api failure.
  // Failing closed here means the legacy page, which is what a non-pilot user
  // should see anyway.
  it('leaves it alone when the flag cannot be resolved', async () => {
    getFlagVariants.mockResolvedValue(null)

    await DoorKnockingSurveysLayout({ children })

    expect(redirect).not.toHaveBeenCalled()
  })
})
