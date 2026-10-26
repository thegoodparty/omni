// Shipped to the IP-sync Lambda as plain JS (transpiled in
// ../databricks-federation.ts), so it must not import anything.

export interface RegisteredTarget {
  ip: string
  state: string
}

export const planTargetChanges = ({
  resolvedIps,
  registeredTargets,
}: {
  resolvedIps: string[]
  registeredTargets: RegisteredTarget[]
}) => {
  if (resolvedIps.length === 0) {
    throw new Error('The cluster endpoint resolved to no addresses')
  }
  const wanted = [...new Set(resolvedIps)]
  // A deregistered target is listed as draining until the deregistration
  // delay ends; counting it would deregister it again on every run.
  const current = registeredTargets
    .filter((target) => target.state !== 'draining')
    .map((target) => target.ip)
  return {
    register: wanted.filter((ip) => !current.includes(ip)).sort(),
    deregister: current.filter((ip) => !wanted.includes(ip)).sort(),
  }
}
