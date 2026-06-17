import { clientRequest } from 'gpApi/typed-request'

export const uploadCampaignPlanPdf = async (blob: Blob): Promise<string> => {
  const formData = new FormData()
  formData.append('file', blob, 'campaign-plan.pdf')
  // The typed payload path JSON-encodes bodies; the overrides argument is
  // applied last, so the FormData (and its multipart boundary, set by the
  // browser) wins.
  const { data } = await clientRequest(
    'POST /v1/campaigns/mine/plan-pdf-share',
    {},
    { body: formData },
  )
  return data.url
}
