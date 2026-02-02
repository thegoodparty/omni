'use client'

import {
  TextField,
  TextArea,
  Text,
  Box,
  Flex,
  Switch,
  Select,
} from '@radix-ui/themes'
import {
  UseFormRegister,
  FieldErrors,
  UseFormWatch,
  UseFormSetValue,
} from 'react-hook-form'
import type { CampaignDetailsFormData } from '../schema'
import { BALLOT_LEVELS, ELECTION_LEVELS } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'

interface CampaignDetailsFormProps {
  register: UseFormRegister<CampaignDetailsFormData>
  errors: FieldErrors<CampaignDetailsFormData>
  watch: UseFormWatch<CampaignDetailsFormData>
  setValue: UseFormSetValue<CampaignDetailsFormData>
}

export function CampaignDetailsForm({
  register,
  errors,
  watch,
  setValue,
}: CampaignDetailsFormProps) {
  return (
    <Flex direction="column" gap="4">
      <InfoCard title="Location">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                State
              </Text>
              <TextField.Root {...register('state')} placeholder="State" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                City
              </Text>
              <TextField.Root {...register('city')} placeholder="City" />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                County
              </Text>
              <TextField.Root {...register('county')} placeholder="County" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                ZIP
              </Text>
              <TextField.Root {...register('zip')} placeholder="ZIP" />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              District
            </Text>
            <TextField.Root {...register('district')} placeholder="District" />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Office">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Office
              </Text>
              <TextField.Root {...register('office')} placeholder="Office" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Other Office
              </Text>
              <TextField.Root
                {...register('otherOffice')}
                placeholder="Other office"
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Flex
              direction="column"
              gap="1"
              flexGrow="1"
              style={{ minWidth: '200px' }}
            >
              <Text as="label" size="2" weight="medium">
                Ballot Level
              </Text>
              <Select.Root
                value={watch('ballotLevel') ?? ''}
                onValueChange={(value) =>
                  setValue(
                    'ballotLevel',
                    value as (typeof BALLOT_LEVELS)[number]
                  )
                }
              >
                <Select.Trigger placeholder="Select level..." />
                <Select.Content>
                  {BALLOT_LEVELS.map((level) => (
                    <Select.Item key={level} value={level}>
                      {level}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex
              direction="column"
              gap="1"
              flexGrow="1"
              style={{ minWidth: '200px' }}
            >
              <Text as="label" size="2" weight="medium">
                Election Level
              </Text>
              <Select.Root
                value={watch('level') ?? '__none__'}
                onValueChange={(value) =>
                  setValue(
                    'level',
                    value === '__none__'
                      ? null
                      : (value as (typeof ELECTION_LEVELS)[number])
                  )
                }
              >
                <Select.Trigger placeholder="Select level..." />
                <Select.Content>
                  <Select.Item value="__none__">None</Select.Item>
                  {ELECTION_LEVELS.map((level) => (
                    <Select.Item key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Term Length
            </Text>
            <TextField.Root
              {...register('officeTermLength')}
              placeholder="e.g., 4 years"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Election">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Election Date
              </Text>
              <TextField.Root {...register('electionDate')} type="date" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Primary Election Date
              </Text>
              <TextField.Root
                {...register('primaryElectionDate')}
                type="date"
              />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Partisan Type
            </Text>
            <TextField.Root
              {...register('partisanType')}
              placeholder="e.g., partisan, nonpartisan"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Filing Period">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Filing Start
            </Text>
            <TextField.Root {...register('filingPeriodsStart')} type="date" />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Filing End
            </Text>
            <TextField.Root {...register('filingPeriodsEnd')} type="date" />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Party">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Party
            </Text>
            <TextField.Root {...register('party')} placeholder="Party" />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Other Party
            </Text>
            <TextField.Root
              {...register('otherParty')}
              placeholder="Other party"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Background">
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Occupation
            </Text>
            <TextField.Root
              {...register('occupation')}
              placeholder="Occupation"
            />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Website
            </Text>
            <TextField.Root
              {...register('website')}
              placeholder="https://..."
              color={errors.website ? 'red' : undefined}
            />
            {errors.website && <ErrorText>{errors.website.message}</ErrorText>}
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Fun Fact
            </Text>
            <TextArea
              {...register('funFact')}
              placeholder="Fun fact..."
              rows={3}
            />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Past Experience
            </Text>
            <TextArea
              {...register('pastExperience')}
              placeholder="Past experience..."
              rows={3}
            />
          </Box>

          <Flex justify="between" align="center">
            <Text as="label" size="2">
              Pledged
            </Text>
            <Switch
              checked={watch('pledged') ?? false}
              onCheckedChange={(checked) => setValue('pledged', checked)}
            />
          </Flex>
        </Flex>
      </InfoCard>
    </Flex>
  )
}
