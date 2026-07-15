import type { IssuePosition, TopIssue } from 'helpers/types'

export type IssueOption = TopIssue

export interface EditIssuePosition {
  id?: number
  type?: 'custom' | 'position'
  topIssue?: TopIssue
  position?: IssuePosition | string
  description?: string
  title?: string
}
