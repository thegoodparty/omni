import type {
  DeleteJobDeadLetterResult,
  JobDeadLetter,
  JobDeadLetterQueues,
  JobDeadLettersListQuery,
  PaginatedList,
  RedriveJobDeadLetterResult,
} from '@goodparty_org/contracts'
import { BaseResource } from './BaseResource'

export class AdminJobDeadLettersResource extends BaseResource {
  protected readonly resourceBasePath = '/admin/job-dead-letters'

  list = (
    options?: JobDeadLettersListQuery
  ): Promise<PaginatedList<JobDeadLetter>> =>
    this.getRequest<PaginatedList<JobDeadLetter>>(
      this.resourceBasePath,
      options
    )

  queues = (): Promise<JobDeadLetterQueues> =>
    this.getRequest<JobDeadLetterQueues>(`${this.resourceBasePath}/queues`)

  get = (id: string): Promise<JobDeadLetter> =>
    this.getRequest<JobDeadLetter>(`${this.resourceBasePath}/${id}`)

  delete = (id: string): Promise<DeleteJobDeadLetterResult> =>
    this.deleteRequest<DeleteJobDeadLetterResult>(
      `${this.resourceBasePath}/${id}`
    )

  redrive = (id: string): Promise<RedriveJobDeadLetterResult> =>
    this.postRequest<RedriveJobDeadLetterResult>(
      `${this.resourceBasePath}/${id}/redrive`,
      {}
    )
}
