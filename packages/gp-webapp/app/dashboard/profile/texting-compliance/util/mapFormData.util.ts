interface AddressComponent {
  types: string[]
  long_name: string
  short_name: string
}

interface Address {
  place_id: string
  formatted_address: string
  address_components?: AddressComponent[]
}

interface PostalAddress {
  postalCode: string
  state: string
  city: string
  streetLines: string[]
}

export interface ManualAddress {
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  zip: string
}

interface FormData {
  ein: string
  address: Address
  manualAddress?: ManualAddress
  campaignCommitteeName: string
  website: string
  electionFilingLink: string
  email: string
  phone: string
  officeLevel: string
  fecCommitteeId?: string
  committeeType?: string
}

interface MappedFormData {
  ein: string
  placeId?: string
  formattedAddress?: string
  manualAddress?: ManualAddress
  committeeName: string
  websiteDomain?: string
  filingUrl: string
  email: string
  phone: string
  officeLevel: string
  fecCommitteeId?: string
  committeeType?: string
}

// TODO: refactor the API to accept the entire Google Places address object so
//  that we don't have to extract the postal address here, we can just pass it
//  along
export const extractPostalAddress = (address: {
  address_components?: AddressComponent[]
}): PostalAddress => {
  if (!address || !address.address_components) {
    return {
      postalCode: '',
      state: '',
      city: '',
      streetLines: [],
    }
  }

  const { address_components } = address

  const extractAddressComponent = (
    types: string | string[],
  ): AddressComponent => {
    const typeArray = Array.isArray(types) ? types : [types]
    const component = address_components.find((comp) =>
      typeArray.some((type) => comp.types.includes(type)),
    )
    return component || { types: [], long_name: '', short_name: '' }
  }

  const streetNumber = extractAddressComponent('street_number').long_name
  const route = extractAddressComponent('route').long_name
  const streetLine =
    streetNumber && route ? `${streetNumber} ${route}` : route || ''

  return {
    postalCode: extractAddressComponent('postal_code').long_name,
    state: extractAddressComponent('administrative_area_level_1').short_name,
    city: extractAddressComponent(['locality', 'neighborhood']).long_name,
    streetLines: streetLine ? [streetLine] : [],
  }
}

export const mapFormData = ({
  ein,
  address: { place_id, formatted_address },
  manualAddress,
  campaignCommitteeName,
  website,
  electionFilingLink,
  email,
  phone,
  officeLevel,
  fecCommitteeId,
  committeeType,
}: FormData): MappedFormData => ({
  ein,
  // The API requires exactly one address source. An intact autocomplete
  // selection (place_id present) wins — the form clears it the moment any
  // address field is hand-edited, so its presence means the selection is
  // authoritative. Otherwise the structured fields ride as manualAddress
  // (placeId/formattedAddress omitted: empty strings fail the API's
  // trim().min(1) validators).
  ...(place_id
    ? { placeId: place_id, formattedAddress: formatted_address }
    : { manualAddress }),
  committeeName: campaignCommitteeName,
  websiteDomain: website || undefined,
  filingUrl: electionFilingLink,
  email,
  phone,
  officeLevel,
  fecCommitteeId,
  committeeType,
})
