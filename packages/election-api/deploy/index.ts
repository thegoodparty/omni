// election-api is retired: gp-api serves its routes and owns the election
// database (components/election-db.ts in gp-api's deploy). This empty program
// lets the next deploy delete the service, load balancer and DNS records this
// stack created. The database resources were marked retainOnDelete, so the
// same deploy only drops them from this stack's state.
export = async () => {}
