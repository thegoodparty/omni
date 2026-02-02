'use client'

import { TextField, Text, Box, Flex, Switch, Callout } from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { UseFormRegister, UseFormWatch, UseFormSetValue } from 'react-hook-form'
import type { ElectedOfficeFormData } from '../schema'
import { InfoCard } from '../../components/InfoCard'

interface ElectedOfficeFormProps {
  register: UseFormRegister<ElectedOfficeFormData>
  watch: UseFormWatch<ElectedOfficeFormData>
  setValue: UseFormSetValue<ElectedOfficeFormData>
  hasElectedOffice: boolean
}

export function ElectedOfficeForm({
  register,
  watch,
  setValue,
  hasElectedOffice,
}: ElectedOfficeFormProps) {
  if (!hasElectedOffice) {
    return (
      <Callout.Root color="gray">
        <Callout.Icon>
          <HiInformationCircle />
        </Callout.Icon>
        <Callout.Text>
          No elected office record exists for this campaign. An elected office
          record is created when a candidate wins their election.
        </Callout.Text>
      </Callout.Root>
    )
  }

  return (
    <Flex direction="column" gap="4">
      <InfoCard title="Term Information">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Elected Date
              </Text>
              <TextField.Root {...register('electedDate')} type="date" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Sworn In Date
              </Text>
              <TextField.Root {...register('swornInDate')} type="date" />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Term Start Date
              </Text>
              <TextField.Root {...register('termStartDate')} type="date" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Term End Date
              </Text>
              <TextField.Root {...register('termEndDate')} type="date" />
            </Box>
          </Flex>

          <Box style={{ maxWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Term Length (Days)
            </Text>
            <TextField.Root
              {...register('termLengthDays')}
              type="number"
              placeholder="e.g., 1461"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Status">
        <Flex justify="between" align="center">
          <Text as="label" size="2">
            Active Office Holder
          </Text>
          <Switch
            checked={watch('isActive') ?? false}
            onCheckedChange={(checked) => setValue('isActive', checked)}
          />
        </Flex>
      </InfoCard>
    </Flex>
  )
}
