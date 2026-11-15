import { describe, expect, it } from 'vitest'
import {
  GET_ANSWERS_MESSAGE,
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
} from '@goodparty_org/contracts'
import { queueManagedPanelTurn } from './managedPanelTurn'

describe('queueManagedPanelTurn', () => {
  it('queues one back out however many times the invite closes', () => {
    const once = queueManagedPanelTurn([], false)
    expect(queueManagedPanelTurn(once, false)).toEqual([
      MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
    ])
  })

  it('lets a set up replace a queued back out, keeping other turns', () => {
    const queue = queueManagedPanelTurn([GET_ANSWERS_MESSAGE], false)
    expect(queueManagedPanelTurn(queue, true)).toEqual([
      GET_ANSWERS_MESSAGE,
      MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
    ])
  })

  it('never adds a back out or a second set up after a set up', () => {
    const queue = queueManagedPanelTurn([], true)
    expect(queueManagedPanelTurn(queue, false)).toEqual([
      MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
    ])
    expect(queueManagedPanelTurn(queue, true)).toEqual([
      MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
    ])
  })
})
