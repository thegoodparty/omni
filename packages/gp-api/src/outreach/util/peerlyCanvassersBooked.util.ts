import { PeerlyJob } from '../../vendors/peerly/peerly.types'

// CAS staff can book canvassers by hand in Peerly, which stamps nothing on
// our row, so the live job is the only record of that booking. The
// completion sweep and the send-day cancel both read it this way.
export const hasPeerlyCanvassersBooked = (job: PeerlyJob): boolean =>
  job.has_canvassers_scheduled || Boolean(job.canvassers_schedule?.approved)
