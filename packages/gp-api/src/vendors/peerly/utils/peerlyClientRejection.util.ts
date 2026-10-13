import { HttpStatus } from '@nestjs/common'
import { isAxiosError } from 'axios'

// Peerly answering 400 or 422 to a call made on behalf of an admin-typed
// value (a test phone number, say) declined the input itself. Whoever typed it
// sees the refusal in the response, so it is not an incident. 401, 403, 429
// and 5xx are credentials, quota or vendor faults and stay out of this.
export const isPeerlyClientRejection = (error: unknown): boolean => {
  if (!isAxiosError(error)) return false
  const status = error.response?.status
  return (
    status === HttpStatus.BAD_REQUEST ||
    status === HttpStatus.UNPROCESSABLE_ENTITY
  )
}
