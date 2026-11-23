import type {
  DeleteJobDeadLetterResult,
  DeleteJobDeadLettersResult,
  JobDeadLetter,
  JobDeadLetterQueues,
  JobDeadLettersListQuery,
  PaginatedList,
  RedriveJobDeadLetterResult,
  RedriveJobDeadLettersResult,
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

  get = (id: string): Promise<JobDeadLetter> =>
    this.getRequest<JobDeadLetter>(`${this.resourceBasePath}/${id}`)

  queues = (): Promise<JobDeadLetterQueues> =>
    this.getRequest<JobDeadLetterQueues>(`${this.resourceBasePath}/queues`)

  redrive = (id: string): Promise<RedriveJobDeadLetterResult> =>
    this.postRequest<RedriveJobDeadLetterResult>(
      `${this.resourceBasePath}/${id}/redrive`,
      {}
    )

  delete = (id: string): Promise<DeleteJobDeadLetterResult> =>
    this.deleteRequest<DeleteJobDeadLetterResult>(
      `${this.resourceBasePath}/${id}`
    )

  redriveMany = (ids: string[]): Promise<RedriveJobDeadLettersResult> =>
    this.postRequest<RedriveJobDeadLettersResult>(
      `${this.resourceBasePath}/batch/redrive`,
      { ids }
    )

  deleteMany = (ids: string[]): Promise<DeleteJobDeadLettersResult> =>
    this.postRequest<DeleteJobDeadLettersResult>(
      `${this.resourceBasePath}/batch/delete`,
      { ids }
    )
}
