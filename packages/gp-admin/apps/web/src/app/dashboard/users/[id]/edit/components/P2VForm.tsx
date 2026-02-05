'use client'

import { TextField, Text, Box, Flex, Select, Switch } from '@radix-ui/themes'
import { useFormContext } from 'react-hook-form'
import type { PathToVictoryFormData } from '../schema'
import { P2V_STATUS } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { INPUT_TYPE, P2V_FORM_SECTIONS } from '../constants'

type P2VStatus = (typeof P2V_STATUS)[number]

// Convert empty/NaN values to undefined to match default values
const numberFieldOptions = {
  setValueAs: (v: string) => {
    if (v === '' || v === null || v === undefined) return undefined
    const num = Number(v)
    return isNaN(num) ? undefined : num
  },
}

function isP2VStatus(value: string): value is P2VStatus {
  return P2V_STATUS.includes(value as P2VStatus)
}

export function P2VForm() {
  const { register, watch, setValue } = useFormContext<PathToVictoryFormData>()

  function handleStatusChange(value: string) {
    if (isP2VStatus(value)) {
      setValue('p2vStatus', value)
    }
  }

  function handleViabilityBooleanChange(
    field: 'isPartisan' | 'isIncumbent' | 'isUncontested',
    checked: boolean
  ) {
    setValue(`viability.${field}`, checked)
  }

  return (
    <Flex direction="column" gap="4">
      <InfoCard title={P2V_FORM_SECTIONS.STATUS}>
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">
              Status
            </Text>
            <Select.Root
              value={watch('p2vStatus') ?? ''}
              onValueChange={handleStatusChange}
            >
              <Select.Trigger placeholder="Select status..." />
              <Select.Content>
                {P2V_STATUS.map((status) => (
                  <Select.Item key={status} value={status}>
                    {status}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Election Type
              </Text>
              <TextField.Root
                {...register('electionType')}
                placeholder="e.g., General, Primary"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Election Location
              </Text>
              <TextField.Root
                {...register('electionLocation')}
                placeholder="Location"
              />
            </Box>
          </Flex>
        </Flex>
      </InfoCard>

      <InfoCard title={P2V_FORM_SECTIONS.TARGET_NUMBERS}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Win Number
              </Text>
              <TextField.Root
                {...register('winNumber', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Voter Contact Goal
              </Text>
              <TextField.Root
                {...register('voterContactGoal', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Total Registered Voters
              </Text>
              <TextField.Root
                {...register('totalRegisteredVoters', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Projected Turnout
              </Text>
              <TextField.Root
                {...register('projectedTurnout', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Average Turnout
              </Text>
              <TextField.Root
                {...register('averageTurnout', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
          </Flex>
        </Flex>
      </InfoCard>

      <InfoCard title={P2V_FORM_SECTIONS.PARTY_DEMOGRAPHICS}>
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Republicans
            </Text>
            <TextField.Root
              {...register('republicans', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Democrats
            </Text>
            <TextField.Root
              {...register('democrats', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Independents
            </Text>
            <TextField.Root
              {...register('indies', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={P2V_FORM_SECTIONS.GENDER_DEMOGRAPHICS}>
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '150px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Men
            </Text>
            <TextField.Root
              {...register('men', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '150px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Women
            </Text>
            <TextField.Root
              {...register('women', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={P2V_FORM_SECTIONS.RACE_DEMOGRAPHICS}>
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              White
            </Text>
            <TextField.Root
              {...register('white', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Asian
            </Text>
            <TextField.Root
              {...register('asian', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              African American
            </Text>
            <TextField.Root
              {...register('africanAmerican', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Hispanic
            </Text>
            <TextField.Root
              {...register('hispanic', numberFieldOptions)}
              type={INPUT_TYPE.NUMBER}
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title={P2V_FORM_SECTIONS.VIABILITY}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Level
              </Text>
              <TextField.Root
                {...register('viability.level')}
                placeholder="Level"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '100px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Seats
              </Text>
              <TextField.Root
                {...register('viability.seats', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '100px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Candidates
              </Text>
              <TextField.Root
                {...register('viability.candidates', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                placeholder="0"
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '120px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Candidates/Seat
              </Text>
              <TextField.Root
                {...register('viability.candidatesPerSeat', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                step="0.01"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '100px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Score
              </Text>
              <TextField.Root
                {...register('viability.score', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                step="0.01"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '120px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Prob. of Win
              </Text>
              <TextField.Root
                {...register('viability.probOfWin', numberFieldOptions)}
                type={INPUT_TYPE.NUMBER}
                step="0.01"
                placeholder="0"
              />
            </Box>
          </Flex>

          <Flex gap="4" wrap="wrap">
            <Flex align="center" gap="2" style={{ minWidth: '120px' }}>
              <Switch
                checked={watch('viability.isPartisan') ?? false}
                onCheckedChange={(checked) =>
                  handleViabilityBooleanChange('isPartisan', checked)
                }
              />
              <Text size="2">Partisan</Text>
            </Flex>
            <Flex align="center" gap="2" style={{ minWidth: '120px' }}>
              <Switch
                checked={watch('viability.isIncumbent') ?? false}
                onCheckedChange={(checked) =>
                  handleViabilityBooleanChange('isIncumbent', checked)
                }
              />
              <Text size="2">Incumbent</Text>
            </Flex>
            <Flex align="center" gap="2" style={{ minWidth: '140px' }}>
              <Switch
                checked={watch('viability.isUncontested') ?? false}
                onCheckedChange={(checked) =>
                  handleViabilityBooleanChange('isUncontested', checked)
                }
              />
              <Text size="2">Uncontested</Text>
            </Flex>
          </Flex>
        </Flex>
      </InfoCard>
    </Flex>
  )
}
