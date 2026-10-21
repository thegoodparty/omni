import { Injectable } from '@nestjs/common'
import { Client } from '@hubspot/api-client'
import { Agent } from 'https'
import {
  MockApi,
  MockBaseDiscovery,
  MockBatchApi,
  MockHubspotClient,
} from './crm.types'

const { HUBSPOT_TOKEN } = process.env

@Injectable()
export class HubspotService {
  private readonly _client: Client

  constructor() {
    this._client = new Client({
      accessToken: HUBSPOT_TOKEN,
      // The SDK's bundled node-fetch 2.7 misreads a reused keep-alive socket
      // on Node 22.23 as a "Premature close" and fails every chunked
      // response (batch reads, owner pages). A fresh socket per call avoids
      // it until the SDK moves off node-fetch.
      httpAgent: new Agent({ keepAlive: false }),
    })
  }

  private isTokenAvailable(): boolean {
    return !!HUBSPOT_TOKEN
  }

  // False off-prod where HUBSPOT_TOKEN is unset and `client` is a no-op mock,
  // so callers can skip writes (and their failure alerts) instead of treating
  // the mock's undefined return as a real HubSpot failure.
  get isConfigured(): boolean {
    return this.isTokenAvailable()
  }

  get client(): Client {
    return this.isTokenAvailable()
      ? this._client
      : // Incompatible types require double assertion — no shared base type exists
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (this.createMockClient() as unknown as Client)
  }

  private createMockClient(): MockHubspotClient {
    const mockResponse = () => Promise.resolve(undefined)
    const mockApi: MockApi = {
      getById: mockResponse,
      create: mockResponse,
      update: mockResponse,
      doSearch: mockResponse,
    }
    const mockBatchApi: MockBatchApi = {
      create: mockResponse,
      update: mockResponse,
    }

    const mockBaseDiscovery: MockBaseDiscovery = {
      config: { accessToken: null },
    }

    return {
      config: { accessToken: null },
      crm: {
        companies: {
          basicApi: mockApi,
          batchApi: mockBatchApi,
        },
        contacts: {
          basicApi: mockApi,
          searchApi: mockApi,
        },
        owners: {
          ownersApi: mockApi,
        },
        associations: {
          v4: {
            batchApi: mockBatchApi,
          },
        },
      },
      automation: {
        ...mockBaseDiscovery,
        actions: mockBaseDiscovery,
      },
      cms: {
        ...mockBaseDiscovery,
        auditLogs: mockBaseDiscovery,
        blogs: mockBaseDiscovery,
        domains: mockBaseDiscovery,
        hubdb: mockBaseDiscovery,
        pages: mockBaseDiscovery,
        performance: mockBaseDiscovery,
        siteSearch: mockBaseDiscovery,
        sourceCode: mockBaseDiscovery,
        urlRedirects: mockBaseDiscovery,
      },
      communicationPreferences: mockBaseDiscovery,
      conversations: mockBaseDiscovery,
      events: mockBaseDiscovery,
      files: mockBaseDiscovery,
      marketing: mockBaseDiscovery,
      oauth: mockBaseDiscovery,
      settings: mockBaseDiscovery,
      webhooks: mockBaseDiscovery,
      init: () => undefined,
      setAccessToken: () => undefined,
      setApiKey: () => undefined,
      setDeveloperApiKey: () => undefined,
      // HubSpot SDK types are loosely typed — properties bag is Record<string, string>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      apiRequest: () => Promise.resolve({} as Response),
    }
  }
}
