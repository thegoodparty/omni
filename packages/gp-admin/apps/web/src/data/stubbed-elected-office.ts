import type { ElectedOffice } from '@/app/dashboard/users/[id]/types/elected-office'

export const stubbedElectedOffice: ElectedOffice = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  createdAt: '2024-11-05T00:00:00.000Z',
  updatedAt: '2024-11-05T00:00:00.000Z',
  userId: 595,
  campaignId: 1,
  electedDate: '2024-11-05',
  swornInDate: '2025-01-06',
  termStartDate: '2025-01-06',
  termLengthDays: 1461, // ~4 years
  termEndDate: '2029-01-05',
  isActive: true,
}

export const stubbedElectedOfficeEmpty: ElectedOffice | null = null
