'use server'

import { gpAction } from '@/shared/util/gpClient.util'

export const getUser = (id: number) =>
  gpAction((client) => client.users.get(id))
