import { describe, expect, it } from 'vitest'
import { isCivicPanelJoinMessage } from './civicPanelJoin.util'

describe('isCivicPanelJoinMessage', () => {
  it.each([
    'JOIN',
    'join',
    'Join!',
    ' join. ',
    'Join please',
    'yes join',
    'Thanks for asking. JOIN',
    'Love the park plan!\nJoin',
  ])('reads %j as a yes', (reply) => {
    expect(isCivicPanelJoinMessage(reply)).toBe(true)
  })

  it.each([
    '',
    null,
    undefined,
    'I would like to join the meeting',
    'joint',
    'rejoin',
    'Can I join?? What is it',
    'STOP',
    'Who is this',
  ])('does not read %j as a yes', (reply) => {
    expect(isCivicPanelJoinMessage(reply)).toBe(false)
  })
})
