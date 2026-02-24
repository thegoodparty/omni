import type { PaginatedList } from '@goodparty_org/contracts'
import type {
  ListPathsToVictoryOptions,
  PathToVictory,
  UpdatePathToVictoryInput,
} from '../types/pathToVictory'
import { BaseResource } from './BaseResource'

export class PathsToVictoryResource extends BaseResource {
  protected resourceBasePath = '/path-to-victory'
  list = (
    options?: ListPathsToVictoryOptions,
  ): Promise<PaginatedList<PathToVictory>> =>
    this.getRequest<PaginatedList<PathToVictory>>(
      `${this.resourceBasePath}/list`,
      options,
    )

  get = (id: number): Promise<PathToVictory> =>
    this.getRequest<PathToVictory>(`${this.resourceBasePath}/${id}`)

  update = (
    id: number,
    input: UpdatePathToVictoryInput,
  ): Promise<PathToVictory> =>
    this.putRequest<PathToVictory>(`${this.resourceBasePath}/${id}`, input)
}
