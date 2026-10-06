import { describe, expect, it } from 'vitest'
import { SPEECH_UPLOAD_ORIGINS } from './meeting-pipeline-bucket'

// The prod bucket's CORS rule is what lets a phone's browser POST an offline
// memo's recording at all. Missing the app's own origin fails every upload
// as a CORS error, silently, from the queue's drain.
describe('the speech bucket upload origins', () => {
  it('admit the prod app on both hosts it is served from', () => {
    expect(SPEECH_UPLOAD_ORIGINS).toEqual(
      expect.arrayContaining([
        'https://goodparty.org',
        'https://app.goodparty.org',
      ]),
    )
  })

  it('are https only', () => {
    for (const origin of SPEECH_UPLOAD_ORIGINS) {
      expect(new URL(origin).protocol).toBe('https:')
    }
  })
})
