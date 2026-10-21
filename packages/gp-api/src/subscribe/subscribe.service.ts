import { Injectable } from '@nestjs/common'
import {
  DEFAULT_SUBSCRIBE_FORM_ID,
  SubscribeEmailSchema,
} from './subscribeEmail.schema'
import { CrmUsersService } from '../users/services/crmUsers.service'

const CONTACT_OBJECT_TYPE_ID = '0-1'

@Injectable()
export class SubscribeService {
  constructor(private readonly crm: CrmUsersService) {}
  async subscribeEmail(body: SubscribeEmailSchema) {
    const {
      email,
      uri,
      name,
      formId,
      pageName,
      firstName,
      lastName,
      additionalFields,
    } = body

    let { phone } = body

    const id = formId || DEFAULT_SUBSCRIBE_FORM_ID

    const crmFields = [
      {
        name: 'email',
        value: email.toLowerCase(),
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      },
    ]
    if (name) {
      crmFields.push({
        name: 'full_name',
        value: name,
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      })
    }
    if (firstName) {
      crmFields.push({
        name: 'firstname',
        value: firstName,
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      })
    }
    if (lastName) {
      crmFields.push({
        name: 'lastName',
        value: lastName,
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      })
    }
    if (phone) {
      // Strip phone to digits only
      phone = phone.replace(/\D/g, '')
      if (phone.length === 10) {
        phone = `+1${phone}`
      } else if (phone.length === 11 && phone[0] === '1') {
        phone = `+${phone}`
      }
      crmFields.push({
        name: 'phone',
        value: phone,
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      })
    }

    for (const field of additionalFields ?? []) {
      crmFields.push({
        name: field.name,
        value: field.value,
        objectTypeId: CONTACT_OBJECT_TYPE_ID,
      })
    }
    const page = pageName || 'homePage'

    this.crm.submitCrmForm(id, crmFields, page, uri)

    return
  }
}
