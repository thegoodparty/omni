import { describe, expect, it } from 'vitest'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import { uploadCampaignPlanPdf } from './sharePlanPdf'

describe('uploadCampaignPlanPdf', () => {
  it('uploads the blob as multipart form data and returns the url', async () => {
    // The typed mocker's function handlers parse POST bodies with
    // request.json(), which breaks on multipart — and reading (or even
    // cloning) the intercepted request's body stream hangs in this
    // environment. So mock a static response and assert on the
    // content-type header via msw's lifecycle events instead.
    let receivedContentType: string | null = null
    const onRequestStart = ({ request }: { request: Request }) => {
      receivedContentType = request.headers.get('content-type')
    }
    mswServer.events.on('request:start', onRequestStart)
    try {
      api.mock('POST /v1/campaigns/mine/plan-pdf-share', {
        status: 200,
        data: { url: 'https://api/share/7/x.pdf' },
      })

      const result = await uploadCampaignPlanPdf(
        new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
      )

      expect(result).toBe('https://api/share/7/x.pdf')
      expect(receivedContentType).toMatch(/multipart\/form-data/)
    } finally {
      mswServer.events.removeListener('request:start', onRequestStart)
    }
  })
})
