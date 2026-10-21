import { Badge, Card, Flex, Text } from '@radix-ui/themes'
import type { SmsVendorAccount } from '@goodparty_org/contracts'
import { LOW_BALANCE_WARNING_USD } from '../types'

interface VendorBalanceCardProps {
  account: SmsVendorAccount | null
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

// Peerly extends credit past zero up to the limit, so a negative balance
// is "sends are running on credit", not an error.
const balanceState = (balance: number) => {
  if (balance <= 0) {
    return { label: 'On credit', color: 'red' as const }
  }
  if (balance < LOW_BALANCE_WARNING_USD) {
    return { label: 'Low', color: 'amber' as const }
  }
  return null
}

export function VendorBalanceCard({ account }: VendorBalanceCardProps) {
  if (!account) {
    return (
      <Card>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray" weight="medium">
            Peerly balance
          </Text>
          <Text size="2" color="gray">
            Unavailable right now
          </Text>
        </Flex>
      </Card>
    )
  }

  const state = balanceState(account.balance)

  return (
    <Card>
      <Flex direction="column" gap="1">
        <Flex align="center" gap="2">
          <Text size="1" color="gray" weight="medium">
            Peerly balance
          </Text>
          {state && (
            <Badge color={state.color} size="1">
              {state.label}
            </Badge>
          )}
        </Flex>
        <Text
          size="6"
          weight="bold"
          color={account.balance <= 0 ? 'red' : undefined}
        >
          {usd.format(account.balance)}
        </Text>
        <Text size="1" color="gray">
          Credit limit {usd.format(account.creditLimit)}
        </Text>
      </Flex>
    </Card>
  )
}
