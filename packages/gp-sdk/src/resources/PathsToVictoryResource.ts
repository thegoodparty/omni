import type { PaginatedList } from '../types/result'
import type {
  ListPathsToVictoryOptions,
  PathToVictory,
  UpdatePathToVictoryInput,
} from '../types/pathToVictory'
import { BaseResource } from './BaseResource'

export class PathsToVictoryResource extends BaseResource {
  list = (
    options?: ListPathsToVictoryOptions,
  ): Promise<PaginatedList<PathToVictory>> =>
    this.getRequest<PaginatedList<PathToVictory>>(
      '/path-to-victory/list',
      options,
    )

  get = (id: number): Promise<PathToVictory> =>
    this.getRequest<PathToVictory>(`/path-to-victory/${id}`)

  update = (
    id: number,
    input: UpdatePathToVictoryInput,
  ): Promise<PathToVictory> =>
    this.putRequest<PathToVictory>(`/path-to-victory/${id}`, input)
}
