import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const loadAgentPrompt = (path: string): string =>
  readFileSync(join(__dirname, 'prompts', path), 'utf8')
