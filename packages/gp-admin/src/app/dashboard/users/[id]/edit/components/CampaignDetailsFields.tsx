import {
  TextField,
  TextArea,
  Text,
  Box,
  Flex,
  Switch,
  Select,
} from '@radix-ui/themes'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import { BallotReadyPositionLevel, ElectionLevel } from '@goodparty_org/sdk'
import {
  INPUT_TYPE,
  CAMPAIGN_FORM_SECTIONS,
  SELECT_NONE_VALUE,
} from '../constants'
import type { CampaignFormFieldsProps } from '../schema'

function isBallotLevel(value: string): value is BallotReadyPositionLevel {
  return Object.values(BallotReadyPositionLevel).includes(
    value as BallotReadyPositionLevel
  )
}

function isElectionLevel(value: string): value is ElectionLevel {
  return Object.values(ElectionLevel).includes(value as ElectionLevel)
}

export function CampaignDetailsFields({
  register,
  watch,
  setValue,
  errors,
}: CampaignFormFieldsProps) {
  function handleBallotLevelChange(value: string) {
    if (value === SELECT_NONE_VALUE) {
      setValue('details.ballotLevel', undefined, { shouldDirty: true })
    } else if (isBallotLevel(value)) {
      setValue('details.ballotLevel', value, { shouldDirty: true })
    }
  }

  function handleElectionLevelChange(value: string) {
    if (value === SELECT_NONE_VALUE) {
      setValue('details.level', null, { shouldDirty: true })
    } else if (isElectionLevel(value)) {
      setValue('details.level', value, { shouldDirty: true })
    }
  }

  return (
    <Flex direction="column" gap="4">
      <InfoCard title={CAMPAIGN_FORM_SECTIONS.LOCATION}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                State
              </Text>
              <TextField.Root
                {...register('details.state')}
                placeholder="State"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                City
              </Text>
              <TextField.Root
                {...register('details.city')}
                placeholder="City"
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                County
              </Text>
              <TextField.Root
                {...register('details.county')}
                placeholder="County"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                ZIP
              </Text>
              <TextField.Root {...register('details.zip')} placeholder="ZIP" />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              District
            </Text>
            <TextField.Root
              {...register('details.district')}
              placeholder="District"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.OFFICE}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Office
              </Text>
              <TextField.Root
                {...register('details.office')}
                placeholder="Office"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Other Office
              </Text>
              <TextField.Root
                {...register('details.otherOffice')}
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
                value={watch('details.ballotLevel') ?? SELECT_NONE_VALUE}
                onValueChange={handleBallotLevelChange}
              >
                <Select.Trigger placeholder="Select level..." />
                <Select.Content>
                  <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                  {Object.values(BallotReadyPositionLevel).map((level) => (
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
                value={watch('details.level') ?? SELECT_NONE_VALUE}
                onValueChange={handleElectionLevelChange}
              >
                <Select.Trigger placeholder="Select level..." />
                <Select.Content>
                  <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                  {Object.values(ElectionLevel).map((level) => (
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
              {...register('details.officeTermLength')}
              placeholder="e.g., 4 years"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.ELECTION}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Election Date
              </Text>
              <TextField.Root
                {...register('details.electionDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Primary Election Date
              </Text>
              <TextField.Root
                {...register('details.primaryElectionDate')}
                type={INPUT_TYPE.DATE}
              />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Partisan Type
            </Text>
            <TextField.Root
              {...register('details.partisanType')}
              placeholder="e.g., partisan, nonpartisan"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.FILING_PERIOD}>
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Filing Start
            </Text>
            <TextField.Root
              {...register('details.filingPeriodsStart')}
              type={INPUT_TYPE.DATE}
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Filing End
            </Text>
            <TextField.Root
              {...register('details.filingPeriodsEnd')}
              type={INPUT_TYPE.DATE}
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.PARTY}>
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Party
            </Text>
            <TextField.Root
              {...register('details.party')}
              placeholder="Party"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Other Party
            </Text>
            <TextField.Root
              {...register('details.otherParty')}
              placeholder="Other party"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.BACKGROUND}>
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Occupation
            </Text>
            <TextField.Root
              {...register('details.occupation')}
              placeholder="Occupation"
            />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Website
            </Text>
            <TextField.Root
              {...register('details.website')}
              placeholder="https://..."
              color={errors.details?.website ? 'red' : undefined}
            />
            {errors.details?.website && (
              <ErrorText>{errors.details.website.message}</ErrorText>
            )}
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Fun Fact
            </Text>
            <TextArea
              {...register('details.funFact')}
              placeholder="Fun fact..."
              rows={3}
            />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Past Experience
            </Text>
            <TextArea
              {...register('details.pastExperience')}
              placeholder="Past experience..."
              rows={3}
            />
          </Box>

          <Flex justify="between" align="center">
            <Text as="label" size="2">
              Pledged
            </Text>
            <Switch
              checked={watch('details.pledged') ?? false}
              onCheckedChange={(checked) =>
                setValue('details.pledged', checked, { shouldDirty: true })
              }
            />
          </Flex>
        </Flex>
      </InfoCard>
    </Flex>
  )
}
