'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod/v4'
import {
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Text,
  TextField,
} from '@radix-ui/themes'
import { HiExclamationCircle, HiKey } from 'react-icons/hi'
import { ErrorText } from '@/components/ErrorText'
import { FORM_MODE } from '@/shared/constants/form'
import { useToast } from '@/components/Toast'
import { issueDomainAuthCode } from '../actions'

const schema = z.object({
  domain: z
    .string()
    .min(1, 'Enter the domain')
    // Apex only, no scheme, no path — matches what gp-api will accept.
    .regex(
      /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
      'Just the domain, e.g. janeforsenate.run'
    ),
})

type FormData = z.infer<typeof schema>

export function DomainAuthCodeForm() {
  const { showToast } = useToast()
  const [isBusy, setIsBusy] = useState(false)
  const [authCode, setAuthCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<FormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(schema),
    defaultValues: { domain: '' },
  })

  async function onSubmit({ domain }: FormData) {
    setIsBusy(true)
    setAuthCode(null)
    setError(null)

    const result = await issueDomainAuthCode(domain)

    if (result.ok) {
      setAuthCode(result.authCode)
    } else {
      setError(result.error)
    }
    setIsBusy(false)
  }

  async function copyCode() {
    if (!authCode) return
    await navigator.clipboard.writeText(authCode)
    showToast('Auth code copied')
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Flex gap="2" align="start">
          <Flex direction="column" flexGrow="1">
            <TextField.Root
              placeholder="janeforsenate.run"
              autoComplete="off"
              {...register('domain')}
            />
            {errors.domain && <ErrorText>{errors.domain.message}</ErrorText>}
          </Flex>
          <Button type="submit" disabled={!isValid || isBusy}>
            <HiKey />
            {isBusy ? 'Requesting…' : 'Get auth code'}
          </Button>
        </Flex>
      </form>

      {error && (
        <Callout.Root color="red" mt="4">
          <Callout.Icon>
            <HiExclamationCircle />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      {authCode && (
        <Card mt="4">
          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              Send this to the candidate directly. It does not expire on our
              side, and we cannot revoke it once shared.
            </Text>
            <Flex gap="2" align="center">
              <Code size="4">{authCode}</Code>
              <Button variant="soft" onClick={copyCode}>
                Copy
              </Button>
            </Flex>
            <Text size="1" color="gray">
              Their new registrar will also need the domain unlocked, and ICANN
              blocks transfers for 60 days after registration or a previous
              transfer.
            </Text>
          </Flex>
        </Card>
      )}
    </>
  )
}
