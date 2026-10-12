import { useFlagOn } from './FeatureFlagsProvider'

export const NEXT_TASK_EXPERIENCE_FLAG_KEY = 'next-task-experience'

interface UseNextTaskExperienceFlagResult {
  ready: boolean
  enabled: boolean
}

// One flag selects the next-task Home (the tab named Home, leading with the
// plan's next task) and the timeline Campaign Plan page; off keeps the
// Campaign Manager home and the plan page they replace (`legacy/`). The two
// pages are the treatment and fire the exposure; the sidebar and title bars
// that only rename the tab pass trackExposure=false.
export const useNextTaskExperienceFlag = (
  trackExposure = true,
): UseNextTaskExperienceFlagResult => {
  const { ready, on } = useFlagOn(NEXT_TASK_EXPERIENCE_FLAG_KEY, {
    trackExposure,
  })
  return { ready, enabled: on }
}
