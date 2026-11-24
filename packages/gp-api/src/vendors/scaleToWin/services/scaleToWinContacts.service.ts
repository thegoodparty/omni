import { Injectable } from '@nestjs/common'
import { Readable } from 'stream'
import {
  CsvUploadBodySchema,
  CsvUploadResponse,
  CsvUploadResponseSchema,
  PresignedPutBodySchema,
  PresignedPutResponse,
  PresignedPutResponseSchema,
  S2W_CONTACT_CSV_UPLOAD_TYPE,
  S2W_PHONE_NUMBER_COLUMN,
  ScaleToWinLoadJob,
  ScaleToWinLoadJobSchema,
} from '../schemas/scaleToWinContacts.schema'
import { ScaleToWinHttpService } from './scaleToWinHttp.service'

const PRESIGNED_PUT_PATH = '/uploads/presigned-put'
const CONTACTS_ENDPOINT = '/subaccounts/:subaccountId/campaigns/:id/contacts'

// The recipient CSV's columns, as delivery writes it.
const CONTACT_FIELD_MAPPING = {
  first_name: 'firstName',
  last_name: 'lastName',
}

const contactsPath = (campaignId: string) =>
  `/campaigns/${encodeURIComponent(campaignId)}/contacts`

export type PutCsvInput = {
  signedPutUrl: string
  body: Readable
  // Presigned S3 PUTs reject a chunked body, so the length is required.
  contentLength: number
}

export type CsvUploadInput = {
  uploadToken: string
  estimatedRowCount: number
}

@Injectable()
export class ScaleToWinContactsService {
  constructor(private readonly http: ScaleToWinHttpService) {}

  // The only call not under /subaccounts: the subaccount rides in the body.
  async presignedPut(fileName: string): Promise<PresignedPutResponse> {
    const body = PresignedPutBodySchema.parse({
      subaccountId: this.http.subaccountId,
      type: S2W_CONTACT_CSV_UPLOAD_TYPE,
      contentType: 'text/csv',
      fileName,
    })
    return this.http.parse(
      PresignedPutResponseSchema,
      await this.http.post(PRESIGNED_PUT_PATH, PRESIGNED_PUT_PATH, body),
      PRESIGNED_PUT_PATH,
    )
  }

  async putCsv({
    signedPutUrl,
    body,
    contentLength,
  }: PutCsvInput): Promise<void> {
    await this.http.putPresigned(signedPutUrl, body, contentLength)
  }

  async csvUpload(
    campaignId: string,
    input: CsvUploadInput,
  ): Promise<CsvUploadResponse> {
    const endpoint = `${CONTACTS_ENDPOINT}/csv-upload`
    const body = CsvUploadBodySchema.parse({
      uploadToken: input.uploadToken,
      estimatedRowCount: input.estimatedRowCount,
      phoneNumberColumn: S2W_PHONE_NUMBER_COLUMN,
      contactFieldMapping: CONTACT_FIELD_MAPPING,
    })
    return this.http.parse(
      CsvUploadResponseSchema,
      await this.http.post(
        this.http.subaccountPath(`${contactsPath(campaignId)}/csv-upload`),
        endpoint,
        body,
      ),
      endpoint,
    )
  }

  async getLoadJob(campaignId: string): Promise<ScaleToWinLoadJob> {
    return this.http.parse(
      ScaleToWinLoadJobSchema,
      await this.http.get(
        this.http.subaccountPath(contactsPath(campaignId)),
        CONTACTS_ENDPOINT,
      ),
      CONTACTS_ENDPOINT,
    )
  }
}
