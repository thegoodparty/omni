import {
  BadGatewayException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common'
import { Campaign, User } from '../../generated/prisma'
import { UsersService } from './users.service'
import { CampaignsService } from '../../campaigns/services/campaigns.service'
import { getMidnightForDate } from '../../shared/util/date.util'
import { HubspotService } from '../../crm/hubspot.service'
import { CRMContactProperties } from '../../crm/crm.types'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { SlackService } from '../../vendors/slack/services/slack.service'
import { Headers, MimeTypes } from 'http-constants-ts'
import { AxiosError, isAxiosError } from 'axios'
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { PinoLogger } from 'nestjs-pino'
import { WrapperType } from 'src/shared/types/utility.types'
import { extractExistingContactId } from '../../crm/util/hubspotErrors.util'

@Injectable()
export class CrmUsersService {
  constructor(
    private readonly hubspot: HubspotService,
    @Inject(forwardRef(() => UsersService))
    private readonly users: WrapperType<UsersService>,
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaigns: WrapperType<CampaignsService>,
    private readonly httpService: HttpService,
    private readonly slack: SlackService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  async calculateCRMContactProperties(
    user: User,
    campaign: Campaign | null,
  ): Promise<CRMContactProperties> {
    const { firstName, lastName, email, phone, zip, metaData } = user
    const meta =
      metaData && typeof metaData === 'object' && !Array.isArray(metaData)
        ? metaData
        : null
    const accountType =
      typeof meta?.accountType === 'string' ? meta.accountType : undefined
    const whyBrowsing =
      typeof meta?.whyBrowsing === 'string' ? meta.whyBrowsing : undefined

    let browsingIntent: string = ''
    switch (whyBrowsing) {
      case 'considering':
        browsingIntent = 'considering run'
        break
      case 'learning':
        browsingIntent = 'learning about gp'
        break
      case 'test':
        browsingIntent = 'testing tools'
        break
      case 'else':
        browsingIntent = 'other'
        break
    }

    return {
      ...(firstName
        ? {
            firstname: firstName,
          }
        : {}),
      ...(lastName
        ? {
            lastname: lastName,
          }
        : {}),
      email,
      ...(phone
        ? {
            phone,
          }
        : {}),
      type: 'Campaign',
      active_candidate: campaign ? 'Yes' : 'No',
      live_candidate: campaign && campaign?.isActive ? 'true' : 'false',
      source: 'GoodParty.org Site',
      ...(zip
        ? {
            zip,
          }
        : {}),
      ...(accountType && campaign?.id
        ? {
            signup_role: accountType === 'browsing' ? accountType : 'running', // Later, once we have campaign staff/volunteer roles, 'helping'
          }
        : {}),
      ...(campaign?.id
        ? {
            product_user: 'yes',
          }
        : {}),
      ...(browsingIntent ? { browsing_intent: browsingIntent } : {}),
    }
  }

  async trackUserLogin(user: User) {
    return await this.trackContact(user, {
      last_login: getMidnightForDate(new Date()).toISOString(),
    })
  }

  private async findCrmContactIdByEmail(email: string) {
    this.logger.debug({ email }, 'Looking up contact by email:')
    try {
      const searchResultObj =
        await this.hubspot.client.crm.contacts.searchApi.doSearch({
          properties: ['email', 'id'],
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: FilterOperatorEnum.Eq,
                  value: email,
                },
              ],
            },
          ],
        })
      this.logger.debug(searchResultObj, 'Search result:')
      const { total, results } = searchResultObj

      const firstResult = results[0]
      if (!total || !firstResult) {
        throw new Error(`No contacts found for email: ${email}`)
      }

      const {
        properties: { email: crmContactEmail },
      } = firstResult
      if (crmContactEmail !== email) {
        // A search-by-email hit whose primary email differs is the merge-
        // survivor shape: the data team's contact merge folds the searched-
        // for email in as a secondary email on a contact whose primary email
        // is now something else. That is a success, not a mismatch — adopt
        // the survivor rather than falling through to a create that would
        // 409 against this same contact.
        this.logger.debug(
          { email, crmContactEmail, crmContactId: firstResult.id },
          'CRM contact primary email differs from lookup email (merged contact) — adopting survivor',
        )
      }

      return firstResult.id
    } catch (e) {
      this.logger.debug(
        { e },
        'could not find contact by email. user has never filled a form!',
      )
      return undefined
    }
  }

  async trackUserUpdate(userId: number) {
    const user = await this.users.findUser({ id: userId })
    if (!user) {
      this.logger.error(`No user found for given user id: ${userId}`)
      return
    }
    const { metaData } = user
    const { profile_updated_count } = metaData || {}
    const updateCount = (profile_updated_count || 0) + 1

    // update profile_updated_count on user
    await this.users.patchUserMetaData(userId, {
      profile_updated_count: updateCount,
    })

    return await this.trackContact(user, {
      profile_updated_date: getMidnightForDate(new Date()).toISOString(),
      profile_updated_count: `${updateCount}`,
    })
  }

  private async trackContact(
    user: User,
    additionalCrmContactProperties?: Partial<CRMContactProperties>,
  ) {
    const { id: userId, email, metaData } = user
    let { hubspotId: crmContactId } = metaData || {}

    const campaign = await this.campaigns.findActiveByUserId(userId)

    const crmContactProperties = await this.calculateCRMContactProperties(
      user,
      campaign,
    )

    if (!crmContactId) {
      crmContactId = await this.findCrmContactIdByEmail(email)
      this.logger.debug({ crmContactId }, 'Found CRM Contact ID by email:')
      crmContactId &&
        (await this.users.patchUserMetaData(userId, {
          hubspotId: crmContactId,
        }))
    }

    const aggregatedCrmContactProperties = {
      ...crmContactProperties,
      ...(additionalCrmContactProperties
        ? { ...additionalCrmContactProperties }
        : {}),
    }

    this.logger.debug(
      aggregatedCrmContactProperties,
      'Aggregated CRM Contact Properties:',
    )

    if (crmContactId) {
      return await this.updateCrmContact(
        crmContactId,
        aggregatedCrmContactProperties,
      )
    } else {
      const newCrmContact = await this.createCrmContact(
        aggregatedCrmContactProperties,
      )
      this.logger.debug({ newCrmContact }, 'New CRM Contact:')
      const { id: newCrmContactId } = newCrmContact || {}
      newCrmContactId &&
        (await this.users.patchUserMetaData(userId, {
          hubspotId: newCrmContactId,
        }))
      return newCrmContact
    }
  }

  async submitCrmForm(
    formId: string,
    fields: Record<string, string>[],
    pageName: string,
    pageUri: string,
    hutk?: string,
  ) {
    if (!this.hubspot.client.config.accessToken) {
      this.logger.debug(
        'No API key found for HubSpot client skipping form submission',
      )
      return
    }
    try {
      return await lastValueFrom(
        this.httpService.post(
          `https://api.hsforms.com/submissions/v3/integration/submit/21589597/${formId}`,
          {
            fields,
            context: {
              pageName,
              pageUri,
              ...(hutk ? { hutk } : {}),
            },
          },
          {
            method: 'POST',
            headers: {
              [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
              [Headers.ACCEPT]: MimeTypes.APPLICATION_JSON,
            },
          },
        ),
      )
    } catch (error) {
      let message = 'Error submitting form to HubSpot: '
      if (isAxiosError(error)) {
        const axiosError = error as AxiosError
        if (axiosError.response) {
          message += JSON.stringify(axiosError.response.data)
          // Handle error response body here
        } else if (axiosError.request) {
          message += axiosError.request
        } else {
          message += axiosError.message
        }
      } else {
        this.logger.error({ error }, 'Unexpected Error:')
      }
      this.logger.error({ message, error }, 'hubspot error')
      await this.slack.errorMessage({ message: 'Error submitting form', error })
      throw new BadGatewayException(message)
    }
  }

  private async updateCrmContact(
    crmContactId: string,
    crmContactProperties: CRMContactProperties,
  ) {
    try {
      return await this.hubspot.client.crm.contacts.basicApi.update(
        crmContactId,
        {
          properties: crmContactProperties,
        },
      )
    } catch (e) {
      this.logger.error(
        { e },
        `error updating contact with CRM id: ${crmContactId}`,
      )
      return undefined
    }
  }

  private async createCrmContact(crmContactProperties: CRMContactProperties) {
    try {
      return await this.hubspot.client.crm.contacts.basicApi.create({
        properties: {
          ...crmContactProperties,
          lifecyclestage: 'opportunity',
        },
      })
    } catch (e) {
      const existingId = extractExistingContactId(e)
      if (!existingId) {
        this.logger.error({ e }, 'error creating contact')
        return undefined
      }
      // The email already belongs to an existing (possibly merged) contact.
      // Adopt it and apply the properties there instead of dropping the sync.
      this.logger.debug(
        { existingId },
        'contact create conflicted with an existing contact — adopting',
      )
      // Fall back to a bare { id } when the follow-up update fails, so
      // trackContact still persists hubspotId and the adoption isn't lost.
      // lifecyclestage matches the create path; HubSpot ignores backward
      // stage moves, so this can't regress an adopted contact's stage.
      return (
        (await this.updateCrmContact(existingId, {
          ...crmContactProperties,
          lifecyclestage: 'opportunity',
        })) ?? { id: existingId }
      )
    }
  }
}
