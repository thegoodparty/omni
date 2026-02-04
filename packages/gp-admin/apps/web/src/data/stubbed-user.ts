import type { User, UserHeaderData } from '@/app/dashboard/users/[id]/types'

export const stubbedUser: User = {
  id: 595,
  createdAt: '2023-04-02T05:51:59.450Z',
  updatedAt: '2026-01-29T03:50:12.433Z',
  firstName: 'Tomer',
  lastName: 'Almog',
  name: 'Tomer Almog',
  avatar: 'https://assets.goodparty.org/candidate-info/g1t9c6ezgl.png',
  email: 'tomer@goodparty.org',
  phone: '13109759102',
  zip: '53212',
  roles: ['candidate'],
  metaData: {
    hubspotId: '31012600096',
    textNotifications: false,
  },
}

export const stubbedUserHeader: UserHeaderData = {
  id: stubbedUser.id,
  name: stubbedUser.name,
  avatar: stubbedUser.avatar,
}
