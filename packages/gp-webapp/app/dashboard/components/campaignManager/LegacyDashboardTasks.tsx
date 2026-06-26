'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { Campaign, TcrCompliance } from 'helpers/types'
import { calculateContactGoalsFromCampaign } from '../voterGoalsHelpers'
import EmptyState from '../EmptyState'
import type { Task } from '../tasks/TaskItem'
import TasksList from '../tasks/TasksList'
import LoadingState from './LoadingState'
import { FailedToGenerate } from './FailedToGenerate'
import { useTaskGenerationStream } from './useTaskGenerationStream'

const TASKS_QUERY_KEY = ['campaignTasks']

interface LegacyDashboardTasksProps {
  campaign: Campaign
  tcrCompliance: TcrCompliance | null
}

// The pre-Campaign-Story dashboard task list: the legacy campaign_task
// generator (streamed) + checklist. Mounted only for the story-off cohort
// (see CampaignManager); the story cohort's tasks live in the campaign tracker
// on the Campaign Plan page. Lifted verbatim out of CampaignManager so its
// generation hooks don't run for the story cohort.
const LegacyDashboardTasks = ({
  campaign,
  tcrCompliance,
}: LegacyDashboardTasksProps): React.JSX.Element => {
  const queryClient = useQueryClient()
  const generatingRef = useRef(false)
  const generatedInSessionRef = useRef(false)
  const trackedGenerationCompleteRef = useRef(false)
  const [showLoadingState, setShowLoadingState] = useState(false)

  const hideLoadingChecklist = useCallback(() => {
    setShowLoadingState(false)
  }, [])

  const { data: tasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: async () => {
      const resp = await clientFetch<Task[]>(apiRoutes.campaign.tasks.list)
      return resp.ok ? resp.data : []
    },
    enabled: !!campaign,
  })

  const onTasksReceived = useCallback(
    (generatedTasks: Task[]) => {
      if (generatedTasks.length > 0) {
        queryClient.setQueryData(TASKS_QUERY_KEY, generatedTasks)
      }
    },
    [queryClient],
  )

  const { isGenerating, error, startGeneration, cancelGeneration } =
    useTaskGenerationStream(onTasksReceived)

  useEffect(() => {
    if (isGenerating) {
      generatedInSessionRef.current = true
      trackedGenerationCompleteRef.current = false
      setShowLoadingState(true)
    }
  }, [isGenerating])

  useEffect(() => {
    if (isLoadingTasks) return
    if (tasks.length > 0) {
      generatingRef.current = false
      return
    }
    if (!campaign || generatingRef.current) return

    generatingRef.current = true
    void startGeneration()

    return () => {
      generatingRef.current = false
      cancelGeneration()
    }
  }, [isLoadingTasks, tasks, campaign, startGeneration, cancelGeneration])

  useEffect(() => {
    if (error) {
      generatingRef.current = false
      setShowLoadingState(false)
    }
  }, [error])

  useEffect(() => {
    if (
      !showLoadingState &&
      tasks.length > 0 &&
      generatedInSessionRef.current &&
      !trackedGenerationCompleteRef.current
    ) {
      trackEvent(EVENTS.Dashboard.CampaignPlan.GenerationCompleted)
      trackedGenerationCompleteRef.current = true
    }
  }, [showLoadingState, tasks.length])

  const contactGoals = calculateContactGoalsFromCampaign(campaign)
  const isStreamComplete =
    !isGenerating && !error && generatedInSessionRef.current

  return (
    <>
      {showLoadingState && (
        <LoadingState
          isStreamComplete={isStreamComplete}
          hideCallback={hideLoadingChecklist}
        />
      )}
      {error && !isGenerating && !showLoadingState && (
        <FailedToGenerate retryGeneration={startGeneration} />
      )}
      {!showLoadingState && (
        <>
          {tasks.length > 0 || contactGoals ? (
            <TasksList
              campaign={campaign}
              tasks={tasks}
              tcrCompliance={tcrCompliance}
            />
          ) : (
            <div className="mt-4">
              <EmptyState />
            </div>
          )}
        </>
      )}
    </>
  )
}

export default LegacyDashboardTasks
