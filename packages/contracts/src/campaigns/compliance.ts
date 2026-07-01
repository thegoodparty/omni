// The candidate bio ("why are you running?") minimum length, measured on
// plain text (HTML stripped). Shared so the gp-api website publish gate and
// the gp-webapp candidate-profile form enforce the identical threshold — a
// divergence would let a candidate author a bio one side accepts and the
// other rejects.
export const MIN_BIO_LENGTH = 500
