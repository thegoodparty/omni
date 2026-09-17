'use client'

import { pdf } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import {
  CampaignPlanPdfDocument,
  type SectionPageMap,
} from './CampaignPlanPdfDocument'
import type { PlanData } from '../components/planContent'

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'campaign-plan'

export type CampaignPlanPdfOptions = {
  liveUrl?: string
}

const buildQrDataUrl = (url: string): Promise<string> =>
  QRCode.toDataURL(url, {
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#1a2a5e', light: '#ffffff' },
  })

export const generateCampaignPlanPdfBlob = async (
  plan: PlanData,
  options: CampaignPlanPdfOptions = {},
): Promise<Blob> => {
  const liveQrDataUrl = options.liveUrl
    ? await buildQrDataUrl(options.liveUrl)
    : undefined

  // Pass 1: render with an empty TOC and a recorder that captures which
  // page each section landed on. The render-callback side effect fires
  // when react-pdf lays out each Page; by the time .toBlob() resolves,
  // pageMap is populated.
  const pageMap: SectionPageMap = {}
  const recordSectionPage = (id: string, pageNumber: number) => {
    if (pageMap[id] === undefined) pageMap[id] = pageNumber
  }

  await pdf(
    <CampaignPlanPdfDocument
      plan={plan}
      liveUrl={options.liveUrl}
      liveQrDataUrl={liveQrDataUrl}
      tocPageMap={null}
      onSectionPage={recordSectionPage}
    />,
  ).toBlob()

  // Pass 2: render again with the populated map so the TOC shows real
  // page numbers. Footer page-number column width is fixed, so the TOC
  // height is identical between passes — section pages don't shift.
  return pdf(
    <CampaignPlanPdfDocument
      plan={plan}
      liveUrl={options.liveUrl}
      liveQrDataUrl={liveQrDataUrl}
      tocPageMap={pageMap}
    />,
  ).toBlob()
}

export const downloadCampaignPlanPdf = async (
  plan: PlanData,
  options: CampaignPlanPdfOptions = {},
): Promise<void> => {
  const blob = await generateCampaignPlanPdfBlob(plan, options)

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugify(
    plan.candidateName || 'campaign-plan',
  )}-campaign-plan.pdf`
  document.body.appendChild(a)
  a.click()
  // Detach the anchor and free the object URL only after the browser has read
  // the blob. Doing either in the same tick as click() cancels the download in
  // current Chrome (the Save-As dialog appears but writes nothing / surfaces as
  // a spurious network error) — worse for this multi-page plan PDF than for a
  // small CSV. Matches the ordinance-export fix (ENG-10860, #1138).
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}
