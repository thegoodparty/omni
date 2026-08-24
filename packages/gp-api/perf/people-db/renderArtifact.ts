import { writeArtifactHtml } from './writeArtifactHtml'

// Re-render the HTML page for an existing JSON artifact, for when a run
// predates a change to the renderer and you do not want to re-run the suite.
const main = (): void => {
  const [jsonPath] = process.argv.slice(2)
  if (!jsonPath) {
    console.error('usage: npm run perf:people-db:html -- <path-to-bench-json>')
    process.exit(1)
  }
  console.log(writeArtifactHtml(jsonPath))
}

main()
