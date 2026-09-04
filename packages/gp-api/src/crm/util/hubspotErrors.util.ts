import {
  ApiException,
  ModelError,
} from '@hubspot/api-client/lib/codegen/crm/contacts'

// HubSpot's duplicate-email create rejection carries the existing contact id
// in the error body's message, e.g. "Contact already exists. Existing ID:
// 12345" — there is no structured field for it in @hubspot/api-client v12.
const EXISTING_CONTACT_ID_PATTERN = /Existing ID:\s*(\d+)/

/**
 * Extracts the existing contact id from a 409 conflict thrown by
 * `crm.contacts.basicApi.create` when the email already belongs to an
 * existing (possibly merged) contact. Returns undefined for any other
 * error, so callers fall back to their normal error handling.
 */
export const extractExistingContactId = (err: unknown): string | undefined => {
  if (!(err instanceof ApiException) || err.code !== 409) {
    return undefined
  }
  // @hubspot/api-client types ApiException's body as the class's erased
  // generic parameter (any); the SDK deserializes 4xx bodies as ModelError.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const body = err.body as ModelError
  return EXISTING_CONTACT_ID_PATTERN.exec(body.message ?? '')?.[1]
}
