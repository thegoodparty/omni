import { Callout } from '@radix-ui/themes'

// This page ships before the endpoints it calls (serve-sms task B2 builds
// them after module wiring). Saying so plainly beats a generic failure,
// which would send whoever hits it looking for an outage that is not there.
export function EndpointsPendingCallout() {
  return (
    <Callout.Root color="amber" mt="4">
      <Callout.Text>
        The results endpoints are not deployed yet. This page is built and
        waiting on them (serve-sms task B2). Nothing is broken and there is
        nothing to do here until they land. To click through the page locally,
        run gp-admin with <code>OUTREACH_RESULTS_FIXTURES=1</code>.
      </Callout.Text>
    </Callout.Root>
  )
}
