'use client'

import { TextField, Text, Box, Flex, Switch, Callout } from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { useFormContext } from 'react-hook-form'
import type { ElectedOfficeFormData } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { INPUT_TYPE, ELECTED_OFFICE_FORM_SECTIONS } from '../constants'

interface ElectedOfficeFormProps {
  hasElectedOffice: boolean
}

export function ElectedOfficeForm({
  hasElectedOffice,
}: ElectedOfficeFormProps) {
  const { register, watch, setValue } = useFormContext<ElectedOfficeFormData>()
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
      <InfoCard title={ELECTED_OFFICE_FORM_SECTIONS.TERM_INFO}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Elected Date
              </Text>
              <TextField.Root
                {...register('electedDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Sworn In Date
              </Text>
              <TextField.Root
                {...register('swornInDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Term Start Date
              </Text>
              <TextField.Root
                {...register('termStartDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Term End Date
              </Text>
              <TextField.Root
                {...register('termEndDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
          </Flex>

          <Box style={{ maxWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Term Length (Days)
            </Text>
            <TextField.Root
              {...register('termLengthDays')}
              type={INPUT_TYPE.NUMBER}
              placeholder="e.g., 1461"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={ELECTED_OFFICE_FORM_SECTIONS.STATUS}>
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
