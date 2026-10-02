import { describe, expect, it } from 'vitest'
import {
  communityResourceCta,
  communityResourceFor,
} from './communityResources'

describe('communityResourceFor', () => {
  it('lets the purpose win over the channel', () => {
    const resource = communityResourceFor('door', 'persuade_voters')

    expect(resource.id).toBe('messaging')
    expect(resource.kind).toBe('webinar')
    expect(resource.href).toBe(
      'https://goodpartyorg.circle.so/c/video-trainings/win-your-race-messaging-that-moves-voters',
    )
    expect(resource.line).toBe(
      'Strengthen your voter conversations with messaging that moves people.',
    )
  })

  it('gives an introduction its own line on the same webinar', () => {
    const resource = communityResourceFor('sms', 'introduce_myself')

    expect(resource.id).toBe('messaging')
    expect(resource.line).toMatch(/^Make your introduction count\./)
  })

  it('sends both turnout purposes to the GOTV course', () => {
    for (const purpose of ['early_voting', 'election_day_turnout']) {
      const resource = communityResourceFor('robocall', purpose)
      expect(resource.id).toBe('gotv')
      expect(resource.kind).toBe('course')
      expect(resource.href).toBe(
        'https://goodpartyorg.circle.so/c/win/sections/980444/lessons/3719939',
      )
    }
  })

  it('falls through to the channel when the purpose has no training of its own', () => {
    const door = communityResourceFor('door', 'event_invite')
    expect(door.id).toBe('voter-contact')
    expect(door.line).toBe(
      'Heading to the doors? Learn the basics of effective voter conversations.',
    )

    const calls = communityResourceFor('phone-bank', 'custom')
    expect(calls.id).toBe('voter-contact')
    expect(calls.href).toBe(
      'https://goodpartyorg.circle.so/c/win/sections/980444/lessons/3719934',
    )
    expect(calls.line).toBe(
      'Build confidence before reaching voters with our Voter Contact training.',
    )

    expect(communityResourceFor('sms', null).id).toBe('voter-contact')
    expect(communityResourceFor('robocall', undefined).id).toBe('voter-contact')
  })

  it('falls back to the resource library when neither purpose nor channel matches', () => {
    const resource = communityResourceFor('social', 'issue_update')

    expect(resource.id).toBe('library')
    expect(resource.kind).toBe('library')
    expect(resource.href).toBe('https://goodpartyorg.circle.so/c/resources')
  })

  it('treats a purpose it does not know as no purpose', () => {
    expect(communityResourceFor('door', 'explain_decision').id).toBe(
      'voter-contact',
    )
  })
})

describe('communityResourceCta', () => {
  it('names the kind of thing the link opens', () => {
    expect(communityResourceCta('course')).toBe('Open course')
    expect(communityResourceCta('webinar')).toBe('Open webinar')
    expect(communityResourceCta('library')).toBe('Open resource library')
  })
})
