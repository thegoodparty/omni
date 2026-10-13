import { z } from 'zod'

/** The most people one random draw can hold, the sampler's own ceiling. */
export const MAX_LIST_SAMPLE_SIZE = 10_000

/**
 * Save a list as a random sample of its criteria rather than as the live
 * filter: `size` people drawn from everyone the criteria match, frozen at
 * save. An audience no bigger than `size` is saved whole.
 */
export const ListSampleSchema = z
  .object({
    size: z.number().int().min(1).max(MAX_LIST_SAMPLE_SIZE),
    /** Names the draw, so the same key draws the same people again. */
    seedKey: z.string().min(1).max(200).optional(),
    /**
     * Outreach already sent to an earlier sample of this audience. Whoever
     * those lists drew is left out, so a wider sample reaches new people.
     */
    excludeOutreachIds: z.array(z.number().int().positive()).max(20).optional(),
    /**
     * Serve only. Of `size`, this many are drawn from the official's citizens'
     * panel and the rest from people not on it, each part its own random draw
     * within the criteria, so one list asks the panel and grows it at once.
     * Absent, the draw ignores the panel.
     */
    panelSize: z.number().int().min(1).max(MAX_LIST_SAMPLE_SIZE).optional(),
  })
  .refine(
    (sample) =>
      sample.panelSize === undefined || sample.panelSize <= sample.size,
    { path: ['panelSize'], message: 'panelSize is part of size' },
  )
export type ListSample = z.infer<typeof ListSampleSchema>
