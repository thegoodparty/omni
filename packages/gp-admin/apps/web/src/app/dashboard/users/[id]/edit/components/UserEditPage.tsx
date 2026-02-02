'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Container,
  Flex,
  Box,
  Tabs,
  Separator,
  Heading,
  Button,
  Text,
  Link,
  Callout,
} from '@radix-ui/themes'
import { HiArrowLeft, HiCheck, HiX } from 'react-icons/hi'
import type { DetailedUser } from '../../types'
import { EDIT_TABS, EDIT_TAB_VALUES, type EditTabValue } from '../../constants'
import {
  userSchema,
  campaignSchema,
  campaignDetailsSchema,
  pathToVictorySchema,
  electedOfficeSchema,
  type UserFormData,
  type CampaignFormData,
  type CampaignDetailsFormData,
  type PathToVictoryFormData,
  type ElectedOfficeFormData,
} from '../schema'
import { UserForm } from './UserForm'
import { CampaignForm } from './CampaignForm'
import { CampaignDetailsForm } from './CampaignDetailsForm'
import { PathToVictoryForm } from './PathToVictoryForm'
import { ElectedOfficeForm } from './ElectedOfficeForm'

interface UserEditPageProps {
  user: DetailedUser
}

function isTabValue(value: string): value is EditTabValue {
  return EDIT_TAB_VALUES.includes(value as EditTabValue)
}

export default function UserEditPage({ user }: UserEditPageProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<EditTabValue>(EDIT_TABS.USER)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const userForm = useForm<UserFormData>({
    mode: 'onChange',
    resolver: zodResolver(userSchema) as Resolver<UserFormData>,
    defaultValues: {
      firstName: user.details.firstName ?? '',
      lastName: user.details.lastName ?? '',
      name: user.data.name ?? '',
      email: '', // Would come from User model
      phone: user.details.phone ?? '',
      zip: user.details.zip ?? '',
      avatar: user.data.image ?? '',
      roles: [],
      metaData: {
        hubspotId: user.data.hubspotId ?? '',
        textNotifications: false,
      },
    },
  })

  const campaignForm = useForm<CampaignFormData>({
    mode: 'onChange',
    resolver: zodResolver(campaignSchema) as Resolver<CampaignFormData>,
    defaultValues: {
      isActive: user.isActive,
      isVerified: user.isVerified ?? false,
      isPro: user.isPro ?? false,
      isDemo: user.isDemo,
      didWin: user.didWin ?? false,
      tier: null, // Note: frontend type is number, Prisma enum is WIN/LOSE/TOSSUP
      canDownloadFederal: user.canDownloadFederal,
      data: {
        launchStatus: user.data.launchStatus as 'launched' | undefined,
        name: user.data.name ?? '',
        adminUserEmail: '', // Would come from data.adminUserEmail
      },
    },
  })

  const detailsForm = useForm<CampaignDetailsFormData>({
    mode: 'onChange',
    resolver: zodResolver(
      campaignDetailsSchema
    ) as Resolver<CampaignDetailsFormData>,
    defaultValues: {
      state: user.details.state ?? '',
      city: user.details.city ?? '',
      county: user.details.county ?? '',
      zip: user.details.zip ?? '',
      district: '', // Would come from details.district
      office: user.details.office ?? '',
      otherOffice: user.details.otherOffice ?? '',
      ballotLevel: user.details.ballotLevel as 'CITY' | 'COUNTY' | undefined,
      level: (user.details.level as 'city' | 'county' | undefined) ?? null,
      officeTermLength: user.details.officeTermLength ?? '',
      electionDate: user.details.electionDate ?? '',
      primaryElectionDate: '', // Would come from details.primaryElectionDate
      partisanType: user.details.partisanType ?? '',
      filingPeriodsStart: user.details.filingPeriodsStart ?? '',
      filingPeriodsEnd: user.details.filingPeriodsEnd ?? '',
      party: user.details.party ?? '',
      otherParty: user.details.otherParty ?? '',
      occupation: user.details.occupation ?? '',
      funFact: user.details.funFact ?? '',
      pastExperience:
        typeof user.details.pastExperience === 'string'
          ? user.details.pastExperience
          : '',
      website: user.details.website ?? '',
      pledged: user.details.pledged ?? false,
    },
  })

  const p2vForm = useForm<PathToVictoryFormData>({
    mode: 'onChange',
    resolver: zodResolver(
      pathToVictorySchema
    ) as Resolver<PathToVictoryFormData>,
    defaultValues: {
      p2vStatus: user.pathToVictory?.data?.p2vStatus as 'Complete' | undefined,
      electionType: user.pathToVictory?.data?.electionType ?? '',
      electionLocation: user.pathToVictory?.data?.electionLocation ?? '',
      winNumber: user.pathToVictory?.data?.winNumber
        ? Number(user.pathToVictory.data.winNumber)
        : undefined,
      voterContactGoal: user.pathToVictory?.data?.voterContactGoal
        ? Number(user.pathToVictory.data.voterContactGoal)
        : undefined,
      totalRegisteredVoters:
        user.pathToVictory?.data?.totalRegisteredVoters ?? undefined,
      projectedTurnout: user.pathToVictory?.data?.projectedTurnout ?? undefined,
      averageTurnout: user.pathToVictory?.data?.averageTurnout ?? undefined,
      republicans: user.pathToVictory?.data?.republicans ?? undefined,
      democrats: user.pathToVictory?.data?.democrats ?? undefined,
      indies: user.pathToVictory?.data?.indies ?? undefined,
      men: user.pathToVictory?.data?.men ?? undefined,
      women: user.pathToVictory?.data?.women ?? undefined,
      white: user.pathToVictory?.data?.white ?? undefined,
      asian: user.pathToVictory?.data?.asian ?? undefined,
      africanAmerican: user.pathToVictory?.data?.africanAmerican ?? undefined,
      hispanic: user.pathToVictory?.data?.hispanic ?? undefined,
      viability: {
        level: user.pathToVictory?.data?.viability?.level ?? '',
        isPartisan: user.pathToVictory?.data?.viability?.isPartisan ?? false,
        isIncumbent:
          user.pathToVictory?.data?.viability?.isIncumbent === 'true',
        isUncontested:
          user.pathToVictory?.data?.viability?.isUncontested === 'true',
        candidates: undefined,
        seats: user.pathToVictory?.data?.viability?.seats ?? undefined,
        candidatesPerSeat: undefined,
        score: user.pathToVictory?.data?.viability?.score ?? undefined,
        probOfWin: undefined,
      },
    },
  })

  const electedOfficeForm = useForm<ElectedOfficeFormData>({
    mode: 'onChange',
    resolver: zodResolver(
      electedOfficeSchema
    ) as Resolver<ElectedOfficeFormData>,
    defaultValues: {
      electedDate: null,
      swornInDate: null,
      termStartDate: null,
      termLengthDays: null,
      termEndDate: null,
      isActive: true,
    },
  })

  const hasElectedOffice = user.didWin === true

  function handleTabChange(value: string) {
    if (isTabValue(value)) {
      setActiveTab(value)
    }
  }

  function handleCancel() {
    router.push(`/dashboard/users/${user.id}`)
  }

  function handleSave() {
    if (activeTab === EDIT_TABS.CAMPAIGN) {
      const campaignData = campaignForm.getValues()
      const detailsData = detailsForm.getValues()

      const campaignResult = campaignSchema.safeParse(campaignData)
      const detailsResult = campaignDetailsSchema.safeParse(detailsData)

      if (!campaignResult.success) {
        console.error('Campaign validation errors:', campaignResult.error)
        return
      }
      if (!detailsResult.success) {
        console.error('Details validation errors:', detailsResult.error)
        return
      }

      console.log('[/campaigns/:id] Saving:', {
        ...campaignData,
        details: detailsData,
      })
    } else {
      const formConfig = {
        [EDIT_TABS.USER]: {
          form: userForm,
          schema: userSchema,
          endpoint: '/users/:id',
        },
        [EDIT_TABS.P2V]: {
          form: p2vForm,
          schema: pathToVictorySchema,
          endpoint: '/path-to-victory/:id',
        },
        [EDIT_TABS.ELECTED_OFFICE]: {
          form: electedOfficeForm,
          schema: electedOfficeSchema,
          endpoint: '/elected-offices/:id',
        },
      }[activeTab]

      if (!formConfig) return

      const data = formConfig.form.getValues()
      const result = formConfig.schema.safeParse(data)

      if (!result.success) {
        console.error('Validation errors:', result.error)
        return
      }

      console.log(`[${formConfig.endpoint}] Saving:`, data)
    }

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  const getFormState = () => {
    if (activeTab === EDIT_TABS.CAMPAIGN) {
      const isDirty =
        campaignForm.formState.isDirty || detailsForm.formState.isDirty
      const isValid =
        campaignForm.formState.isValid && detailsForm.formState.isValid
      return { isDirty, isValid }
    }

    const formMap = {
      [EDIT_TABS.USER]: userForm,
      [EDIT_TABS.P2V]: p2vForm,
      [EDIT_TABS.ELECTED_OFFICE]: electedOfficeForm,
    }
    const form = formMap[activeTab]
    return {
      isDirty: form?.formState.isDirty ?? false,
      isValid: form?.formState.isValid ?? true,
    }
  }

  const { isDirty, isValid } = getFormState()

  return (
    <Container size="4">
      <Box mb="6">
        <Flex gap="4" align="center" mb="4">
          <Link
            href={`/dashboard/users/${user.id}`}
            className="text-[var(--gray-11)] hover:text-[var(--gray-12)]"
          >
            <HiArrowLeft className="w-5 h-5" />
          </Link>
          <Box>
            <Heading size="7">Edit User</Heading>
            <Text size="3" color="gray">
              {user.data.name}
            </Text>
          </Box>
        </Flex>
      </Box>

      {saveSuccess && (
        <Callout.Root color="green" mb="4">
          <Callout.Icon>
            <HiCheck />
          </Callout.Icon>
          <Callout.Text>Changes saved (simulated)</Callout.Text>
        </Callout.Root>
      )}

      <Separator size="4" mb="6" />

      <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
        <Tabs.List mb="4">
          <Tabs.Trigger value={EDIT_TABS.USER}>User</Tabs.Trigger>
          <Tabs.Trigger value={EDIT_TABS.CAMPAIGN}>Campaign</Tabs.Trigger>
          <Tabs.Trigger value={EDIT_TABS.P2V}>Path to Victory</Tabs.Trigger>
          <Tabs.Trigger value={EDIT_TABS.ELECTED_OFFICE}>
            Elected Office
          </Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value={EDIT_TABS.USER}>
            <UserForm
              register={userForm.register}
              errors={userForm.formState.errors}
              watch={userForm.watch}
              setValue={userForm.setValue}
            />
          </Tabs.Content>

          <Tabs.Content value={EDIT_TABS.CAMPAIGN}>
            <Flex direction="column" gap="6">
              <CampaignForm
                register={campaignForm.register}
                errors={campaignForm.formState.errors}
                watch={campaignForm.watch}
                setValue={campaignForm.setValue}
              />
              <CampaignDetailsForm
                register={detailsForm.register}
                errors={detailsForm.formState.errors}
                watch={detailsForm.watch}
                setValue={detailsForm.setValue}
              />
            </Flex>
          </Tabs.Content>

          <Tabs.Content value={EDIT_TABS.P2V}>
            <PathToVictoryForm
              register={p2vForm.register}
              watch={p2vForm.watch}
              setValue={p2vForm.setValue}
            />
          </Tabs.Content>

          <Tabs.Content value={EDIT_TABS.ELECTED_OFFICE}>
            <ElectedOfficeForm
              register={electedOfficeForm.register}
              watch={electedOfficeForm.watch}
              setValue={electedOfficeForm.setValue}
              hasElectedOffice={hasElectedOffice}
            />
          </Tabs.Content>
        </Box>
      </Tabs.Root>

      <Separator size="4" my="6" />

      <Flex gap="3" justify="end">
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={handleCancel}
        >
          <HiX className="w-4 h-4" />
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isValid || !isDirty}
        >
          <HiCheck className="w-4 h-4" />
          Save Changes
        </Button>
      </Flex>
    </Container>
  )
}
