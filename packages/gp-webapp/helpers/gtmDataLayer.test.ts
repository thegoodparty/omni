import { describe, it, expect, beforeEach } from 'vitest'
import {
  pushToDataLayer,
  pushSignUpToDataLayer,
  setDataLayerUserId,
} from './gtmDataLayer'

type WindowWithDataLayer = { dataLayer?: Record<string, unknown>[] }

const w = window as unknown as WindowWithDataLayer

describe('gtmDataLayer', () => {
  beforeEach(() => {
    delete w.dataLayer
  })

  it('creates the dataLayer when GTM has not initialized it yet', () => {
    pushToDataLayer({ event: 'anything' })

    expect(w.dataLayer).toEqual([{ event: 'anything' }])
  })

  it('appends to an existing dataLayer', () => {
    w.dataLayer = [{ 'gtm.start': 1 }]

    pushToDataLayer({ event: 'anything' })

    expect(w.dataLayer).toEqual([{ 'gtm.start': 1 }, { event: 'anything' }])
  })

  it('pushes the user id as a string', () => {
    setDataLayerUserId(42)

    expect(w.dataLayer).toEqual([{ user_id: '42' }])
  })

  it('clears the user id on sign-out', () => {
    setDataLayerUserId(42)
    setDataLayerUserId(null)

    expect(w.dataLayer).toEqual([{ user_id: '42' }, { user_id: undefined }])
  })

  it('pushes a sign_up event with the method and user id', () => {
    pushSignUpToDataLayer({ userId: 42, method: 'email' })

    expect(w.dataLayer).toEqual([
      { event: 'sign_up', method: 'email', user_id: '42' },
    ])
  })
})
