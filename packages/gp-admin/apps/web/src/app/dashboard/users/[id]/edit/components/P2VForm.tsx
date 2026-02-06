'use client'

import {
  TextField,
  Text,
  Box,
  Flex,
  Select,
  Switch,
  Separator,
} from '@radix-ui/themes'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  pathToVictorySchema,
  type PathToVictoryFormData,
  P2V_STATUS,
} from '../schema'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { FormActions } from './FormActions'
import {
  INPUT_TYPE,
  P2V_FORM_SECTIONS,
  FORM_MODE,
  UNSAVED_CHANGES_MESSAGE,
} from '../constants'
import type { PathToVictory } from '../../types/p2v'

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

interface P2VFormProps {
  initialData: PathToVictory | null
  onSave: (data: PathToVictoryFormData) => void
  onCancel: () => void
}

export function P2VForm({ initialData, onSave, onCancel }: P2VFormProps) {
  const p2v = initialData

  const {
    register,
    watch,
    setValue,
    getValues,
    formState: { isDirty, isValid },
  } = useForm<PathToVictoryFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(pathToVictorySchema),
    defaultValues: {
      p2vStatus: p2v?.data?.p2vStatus,
      electionType: p2v?.data?.electionType ?? '',
      electionLocation: p2v?.data?.electionLocation ?? '',
      winNumber: p2v?.data?.winNumber ? Number(p2v.data.winNumber) : undefined,
      voterContactGoal: p2v?.data?.voterContactGoal
        ? Number(p2v.data.voterContactGoal)
        : undefined,
      totalRegisteredVoters: p2v?.data?.totalRegisteredVoters ?? undefined,
      projectedTurnout: p2v?.data?.projectedTurnout ?? undefined,
      averageTurnout: p2v?.data?.averageTurnout ?? undefined,
      republicans: p2v?.data?.republicans ?? undefined,
      democrats: p2v?.data?.democrats ?? undefined,
      indies: p2v?.data?.indies ?? undefined,
      men: p2v?.data?.men ?? undefined,
      women: p2v?.data?.women ?? undefined,
      white: p2v?.data?.white ?? undefined,
      asian: p2v?.data?.asian ?? undefined,
      africanAmerican: p2v?.data?.africanAmerican ?? undefined,
      hispanic: p2v?.data?.hispanic ?? undefined,
      viability: {
        level: p2v?.data?.viability?.level ?? '',
        isPartisan: p2v?.data?.viability?.isPartisan ?? false,
        isIncumbent: p2v?.data?.viability?.isIncumbent === true,
        isUncontested: p2v?.data?.viability?.isUncontested === true,
        candidates: p2v?.data?.viability?.candidates
          ? Number(p2v.data.viability.candidates)
          : undefined,
        seats: p2v?.data?.viability?.seats ?? undefined,
        candidatesPerSeat: p2v?.data?.viability?.candidatesPerSeat
          ? Number(p2v.data.viability.candidatesPerSeat)
          : undefined,
        score: p2v?.data?.viability?.score ?? undefined,
        probOfWin: undefined,
      },
    },
  })

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  function handleSubmit() {
    const data = getValues()
    const result = pathToVictorySchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    onSave(data)
  }

  function handleStatusChange(value: string) {
    if (isP2VStatus(value)) {
      setValue('p2vStatus', value, { shouldDirty: true })
    }
  }

  function handleViabilityBooleanChange(
    field: 'isPartisan' | 'isIncumbent' | 'isUncontested',
    checked: boolean
  ) {
    setValue(`viability.${field}`, checked, { shouldDirty: true })
  }

  return (
    <>
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
                  {...register(
                    'viability.candidatesPerSeat',
                    numberFieldOptions
                  )}
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

      <Separator size="4" my="6" />

      <FormActions
        onCancel={onCancel}
        onSubmit={handleSubmit}
        isValid={isValid}
        isDirty={isDirty}
      />
    </>
  )
}
