import { readFileSync, writeFileSync } from 'node:fs'
import { buildArtifactHtml, type ArtifactData } from './artifactHtml'

// Reads a benchmark JSON artifact and writes the fixed-format HTML page beside
// it. Split from artifactHtml.ts so the renderer itself stays pure and
// unit-testable with no filesystem in the way.
export const writeArtifactHtml = (jsonPath: string): string => {
  const raw = readFileSync(jsonPath, 'utf8')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const data = JSON.parse(raw) as ArtifactData
  const htmlPath = jsonPath.replace(/\.json$/, '.html')
  writeFileSync(htmlPath, buildArtifactHtml(data))
  return htmlPath
}
