'use client'

import { TextField, Text, Box, Flex, Select, Switch } from '@radix-ui/themes'
import { UseFormRegister, UseFormWatch, UseFormSetValue } from 'react-hook-form'
import type { PathToVictoryFormData } from '../schema'
import { P2V_STATUS } from '../schema'
import { InfoCard } from '../../components/InfoCard'

interface P2VFormProps {
  register: UseFormRegister<PathToVictoryFormData>
  watch: UseFormWatch<PathToVictoryFormData>
  setValue: UseFormSetValue<PathToVictoryFormData>
}

export function P2VForm({ register, watch, setValue }: P2VFormProps) {
  return (
    <Flex direction="column" gap="4">
      <InfoCard title="P2V Status">
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">
              Status
            </Text>
            <Select.Root
              value={watch('p2vStatus') ?? ''}
              onValueChange={(value) =>
                setValue('p2vStatus', value as (typeof P2V_STATUS)[number])
              }
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

      <InfoCard title="Target Numbers">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Win Number
              </Text>
              <TextField.Root
                {...register('winNumber')}
                type="number"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Voter Contact Goal
              </Text>
              <TextField.Root
                {...register('voterContactGoal')}
                type="number"
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
                {...register('totalRegisteredVoters')}
                type="number"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Projected Turnout
              </Text>
              <TextField.Root
                {...register('projectedTurnout')}
                type="number"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Average Turnout
              </Text>
              <TextField.Root
                {...register('averageTurnout')}
                type="number"
                placeholder="0"
              />
            </Box>
          </Flex>
        </Flex>
      </InfoCard>

      <InfoCard title="Demographics - Party Affiliation">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Republicans
            </Text>
            <TextField.Root
              {...register('republicans')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Democrats
            </Text>
            <TextField.Root
              {...register('democrats')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Independents
            </Text>
            <TextField.Root
              {...register('indies')}
              type="number"
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Demographics - Gender">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '150px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Men
            </Text>
            <TextField.Root
              {...register('men')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '150px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Women
            </Text>
            <TextField.Root
              {...register('women')}
              type="number"
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Demographics - Race/Ethnicity">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              White
            </Text>
            <TextField.Root
              {...register('white')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Asian
            </Text>
            <TextField.Root
              {...register('asian')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              African American
            </Text>
            <TextField.Root
              {...register('africanAmerican')}
              type="number"
              placeholder="0"
            />
          </Box>
          <Box flexGrow="1" style={{ minWidth: '120px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              Hispanic
            </Text>
            <TextField.Root
              {...register('hispanic')}
              type="number"
              placeholder="0"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Viability Analysis">
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
                {...register('viability.seats')}
                type="number"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '100px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Candidates
              </Text>
              <TextField.Root
                {...register('viability.candidates')}
                type="number"
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
                {...register('viability.candidatesPerSeat')}
                type="number"
                step="0.01"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '100px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Score
              </Text>
              <TextField.Root
                {...register('viability.score')}
                type="number"
                step="0.01"
                placeholder="0"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '120px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Prob. of Win
              </Text>
              <TextField.Root
                {...register('viability.probOfWin')}
                type="number"
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
                  setValue('viability.isPartisan', checked)
                }
              />
              <Text size="2">Partisan</Text>
            </Flex>
            <Flex align="center" gap="2" style={{ minWidth: '120px' }}>
              <Switch
                checked={watch('viability.isIncumbent') ?? false}
                onCheckedChange={(checked) =>
                  setValue('viability.isIncumbent', checked)
                }
              />
              <Text size="2">Incumbent</Text>
            </Flex>
            <Flex align="center" gap="2" style={{ minWidth: '140px' }}>
              <Switch
                checked={watch('viability.isUncontested') ?? false}
                onCheckedChange={(checked) =>
                  setValue('viability.isUncontested', checked)
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
