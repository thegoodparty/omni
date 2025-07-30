import parsePhoneNumber from 'libphonenumber-js'

export default function formatPhoneNumber(phoneNumber: string) {
  const parsedPhoneNumber = parsePhoneNumber(phoneNumber, 'US')
  return parsedPhoneNumber?.formatNational() || phoneNumber
}


export function phoneUri(phoneNumber: string) {
    const parsedPhoneNumber = parsePhoneNumber(phoneNumber, 'US')
    return parsedPhoneNumber?.getURI() || phoneNumber
  }