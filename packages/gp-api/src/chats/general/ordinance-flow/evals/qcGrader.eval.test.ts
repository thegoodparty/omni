import { overrideEnvForEvals } from '../../../evals/envOverride'

// Must run before the app graph constructs LlmService, so the real ANTHROPIC
// key from .env wins over the .env.test stub.
overrideEnvForEvals()

import { describe, expect, it } from 'vitest'
import type { OrdinanceQualityReport } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { OrdinanceQualityReportService } from '@/ordinances/services/ordinanceQualityReport.service'
import { seedFromFixture } from './seedFromFixture'
import { QC_BROKEN_DRAFTS, QC_CLEAN_DRAFT } from './fixtures/qcDrafts'

// Real-Claude eval for the shipped OrdinanceQualityReportService — the quality
// loop's objective function. Measures two things: that the grader flags an
// injected defect the clean draft doesn't have, and that it grades the clean
// draft with a repeatable per-check status. Gated by RUN_LLM_EVALS=1 — skipped
// in the normal suite and in CI, run by hand:
//   RUN_LLM_EVALS=1 npx vitest run \
//     src/chats/general/ordinance-flow/evals/qcGrader.eval.test.ts
const RUN = process.env.RUN_LLM_EVALS === '1'
const d = RUN ? describe : describe.skip

const QC_TIMEOUT_MS = 240_000
const STABILITY_RUNS = 3

const service = useTestService()

// Seed a fully-populated bike-parking ordinance (all prior steps present),
// overwrite its draft with the given body, then grade the persisted record —
// the DB row is the source of truth the shipped service reads.
const gradeDraft = async (
  draftBody: string,
): Promise<OrdinanceQualityReport> => {
  const seeded = await seedFromFixture(
    service.prisma,
    service.user.id,
    'bike-parking',
    'review',
  )
  await service.prisma.ordinance.update({
    where: { id: seeded.ordinanceId },
    data: { draftBody },
  })
  const record = await service.prisma.ordinance.findUniqueOrThrow({
    where: { id: seeded.ordinanceId },
  })
  return service.app
    .get(OrdinanceQualityReportService)
    .generate(record, service.user.id)
}

const statusOf = (report: OrdinanceQualityReport, id: string) =>
  report.checks.find((c) => c.id === id)?.status

// Grade the clean baseline once and share it across the targeted-flag tests to
// bound LLM cost; each broken draft is graded on its own.
let cleanReport: Promise<OrdinanceQualityReport> | null = null
const cleanBaseline = (): Promise<OrdinanceQualityReport> =>
  (cleanReport ??= gradeDraft(QC_CLEAN_DRAFT.draftBody))

d('ordinance QC grader eval (real Claude)', () => {
  for (const broken of QC_BROKEN_DRAFTS) {
    it(
      `flags ${broken.name} on [${broken.expectFlaggedCheckIds.join(', ')}] ` +
        'while the clean draft does not',
      async () => {
        const [clean, report] = await Promise.all([
          cleanBaseline(),
          gradeDraft(broken.draftBody),
        ])

        // A true delta: the injected defect must make at least one target
        // check STRICTLY worse than the clean baseline (pass < attention <
        // flag). Asserting the broken draft merely reached attention/flag would
        // pass even if the clean draft already sat there — no signal the grader
        // reacted to the defect at all.
        const rank = (s: string | undefined): number =>
          s === 'flag' ? 2 : s === 'attention' ? 1 : 0
        const worsened = broken.expectFlaggedCheckIds.filter(
          (id) => rank(statusOf(report, id)) > rank(statusOf(clean, id)),
        )
        expect(
          worsened.length,
          `no target check worsened vs clean for ${broken.name}: ` +
            broken.expectFlaggedCheckIds
              .map(
                (id) =>
                  `${id} clean=${statusOf(clean, id)} broken=${statusOf(report, id)}`,
              )
              .join(', '),
        ).toBeGreaterThan(0)
      },
      QC_TIMEOUT_MS,
    )
  }

  it(
    'grades the clean draft with a stable per-check status across k=3 runs',
    async () => {
      const reports = await Promise.all(
        Array.from({ length: STABILITY_RUNS }, () =>
          gradeDraft(QC_CLEAN_DRAFT.draftBody),
        ),
      )
      const ids = new Set(reports.flatMap((r) => r.checks.map((c) => c.id)))
      const flips = [...ids]
        .map((id) => ({ id, statuses: reports.map((r) => statusOf(r, id)) }))
        .filter(({ statuses }) => new Set(statuses).size > 1)
      expect(flips).toEqual([])
    },
    QC_TIMEOUT_MS,
  )
})
