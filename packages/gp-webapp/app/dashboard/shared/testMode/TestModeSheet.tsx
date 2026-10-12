'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'
import {
  useOrganization,
  useSetOrganizationSlug,
} from '@shared/organization-picker'
import { useTestMode } from './useTestMode'
import type {
  TestModeOrganizationType,
  TestModeOnboardingPreset,
  TestModeProPreset,
  TestModeElectionPreset,
  TestModeTermPreset,
  TestModeTenDlcPreset,
  TestModeActiveOrganization,
  TestModeOrganization,
} from '@goodparty_org/contracts'
import type { Race } from 'app/onboarding/[slug]/[step]/components/ballotOffices/types'

const isZipValid = (zip: string) => /^\d{5}$/.test(zip)

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TestModeSheet({ open, onOpenChange }: Props) {
  const { query, createMutation, applyMutation, deleteMutation } = useTestMode()
  const [type, setType] = useState<TestModeOrganizationType>('campaign')

  // Campaign form state
  const [zip, setZip] = useState('')
  const [submittedZip, setSubmittedZip] = useState('')
  const [selectedOffice, setSelectedOffice] = useState('')

  // Preset state
  const [onboarding, setOnboarding] =
    useState<TestModeOnboardingPreset>('complete')
  const [pro, setPro] = useState<TestModeProPreset>('off')
  const [election, setElection] = useState<TestModeElectionPreset>('in_8_weeks')
  const [tenDlc, setTenDlc] = useState<TestModeTenDlcPreset>('none')
  const [term, setTerm] = useState<TestModeTermPreset>('active')

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const racesQuery = useQuery<Race[]>({
    queryKey: ['test-mode-races', submittedZip],
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/elections/races-by-year', {
        zipcode: submittedZip,
        timeframe: 'future',
      })
      return data.filter((r) => !r.isPrimary && !r.isRunoff)
    },
    enabled: Boolean(submittedZip && isZipValid(submittedZip)),
  })

  const races = racesQuery.data ?? []
  const activeOrg = useOrganization()
  const setSelectedSlug = useSetOrganizationSlug()

  const handleCreate = () => {
    if (type === 'campaign') {
      createMutation.mutate({
        type: 'campaign',
        race: { zip: submittedZip, office: selectedOffice },
        onboarding,
        pro,
        election,
        tenDlc,
      })
    } else {
      createMutation.mutate({
        type: 'elected_office',
        onboarding,
        term,
      })
    }
  }

  const canCreate =
    type === 'campaign'
      ? Boolean(submittedZip && selectedOffice && !createMutation.isPending)
      : !createMutation.isPending

  const testOrgs = query.data?.organizations ?? []
  const activeTestOrg = query.data?.active ?? null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="w-full sm:max-w-lg"
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>Test mode</SheetTitle>
          </SheetHeader>

          <SheetBody className="mt-2 gap-8">
            {/* Create form */}
            <section className="space-y-4">
              <h2 className="text-sm font-semibold">New test organization</h2>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Type</label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as TestModeOrganizationType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="campaign">Campaign</SelectItem>
                    <SelectItem value="elected_office">
                      Elected Office
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {type === 'campaign' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Zip code
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={zip}
                        onChange={(e) => setZip(e.target.value)}
                        placeholder="12345"
                        maxLength={5}
                      />
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          if (isZipValid(zip)) {
                            setSubmittedZip(zip)
                            setSelectedOffice('')
                          }
                        }}
                        disabled={!isZipValid(zip)}
                      >
                        Search
                      </Button>
                    </div>
                  </div>

                  {races.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Office
                      </label>
                      <Select
                        value={selectedOffice}
                        onValueChange={setSelectedOffice}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select office" />
                        </SelectTrigger>
                        <SelectContent>
                          {races.map((race) => (
                            <SelectItem
                              key={race.id}
                              value={race.position.name}
                            >
                              {race.position.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Onboarding
                    </label>
                    <Select
                      value={onboarding}
                      onValueChange={(v) =>
                        setOnboarding(v as TestModeOnboardingPreset)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="complete">complete</SelectItem>
                        <SelectItem value="not_started">not_started</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Pro</label>
                    <Select
                      value={pro}
                      onValueChange={(v) => setPro(v as TestModeProPreset)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">off</SelectItem>
                        <SelectItem value="on">on</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Election
                    </label>
                    <Select
                      value={election}
                      onValueChange={(v) =>
                        setElection(v as TestModeElectionPreset)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_8_weeks">in_8_weeks</SelectItem>
                        <SelectItem value="in_1_week">in_1_week</SelectItem>
                        <SelectItem value="passed_unanswered">
                          passed_unanswered
                        </SelectItem>
                        <SelectItem value="passed_won">passed_won</SelectItem>
                        <SelectItem value="passed_lost">passed_lost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      10DLC
                    </label>
                    <Select
                      value={tenDlc}
                      onValueChange={(v) =>
                        setTenDlc(v as TestModeTenDlcPreset)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">none</SelectItem>
                        <SelectItem value="in_progress">in_progress</SelectItem>
                        <SelectItem value="filing_hold">filing_hold</SelectItem>
                        <SelectItem value="awaiting_pin">
                          awaiting_pin
                        </SelectItem>
                        <SelectItem value="in_review">in_review</SelectItem>
                        <SelectItem value="approved">approved</SelectItem>
                        <SelectItem value="rejected">rejected</SelectItem>
                        <SelectItem value="error">error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {type === 'elected_office' && (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Onboarding
                    </label>
                    <Select
                      value={onboarding}
                      onValueChange={(v) =>
                        setOnboarding(v as TestModeOnboardingPreset)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="complete">complete</SelectItem>
                        <SelectItem value="not_started">not_started</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Term
                    </label>
                    <Select
                      value={term}
                      onValueChange={(v) => setTerm(v as TestModeTermPreset)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="ending_soon">ending_soon</SelectItem>
                        <SelectItem value="ended">ended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <Button
                onClick={handleCreate}
                disabled={!canCreate}
                className="w-full"
              >
                {createMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </section>

            {/* Org list */}
            {testOrgs.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-sm font-semibold">
                  Your test organizations
                </h2>
                <div className="space-y-3">
                  {testOrgs.map((org) => (
                    <OrgRow
                      key={org.slug}
                      org={org}
                      activeTestOrg={activeTestOrg}
                      isActiveOrg={activeOrg?.slug === org.slug}
                      onSwitch={() => {
                        setSelectedSlug(org.slug)
                      }}
                      onApply={(req) => applyMutation.mutate(req)}
                      onDeleteRequest={() => setDeleteTarget(org.slug)}
                      isApplying={applyMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete test organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the test organization and all its
              data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget)
                  setDeleteTarget(null)
                }
              }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface OrgRowProps {
  org: TestModeOrganization
  activeTestOrg: TestModeActiveOrganization | null
  isActiveOrg: boolean
  onSwitch: () => void
  onApply: (
    req: import('@goodparty_org/contracts').ApplyTestModeRequest,
  ) => void
  onDeleteRequest: () => void
  isApplying: boolean
}

function OrgRow({
  org,
  activeTestOrg,
  isActiveOrg,
  onSwitch,
  onApply,
  onDeleteRequest,
  isApplying,
}: OrgRowProps) {
  const families = isActiveOrg && activeTestOrg ? activeTestOrg.families : null

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium">{org.name}</span>
          {isActiveOrg && (
            <Badge variant="secondary" className="shrink-0">
              active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isActiveOrg && (
            <Button variant="outline" size="small" onClick={onSwitch}>
              Switch to
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            onClick={onDeleteRequest}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        </div>
      </div>

      {families && (
        <div className="space-y-1.5">
          {families.onboarding && (
            <FamilyRow
              label="onboarding"
              state={families.onboarding}
              onApply={(preset) =>
                onApply({
                  family: 'onboarding',
                  preset: preset as TestModeOnboardingPreset,
                })
              }
              isApplying={isApplying}
            />
          )}
          {families.pro && (
            <FamilyRow
              label="pro"
              state={families.pro}
              onApply={(preset) =>
                onApply({ family: 'pro', preset: preset as TestModeProPreset })
              }
              isApplying={isApplying}
            />
          )}
          {families.election && (
            <FamilyRow
              label="election"
              state={families.election}
              onApply={(preset) =>
                onApply({
                  family: 'election',
                  preset: preset as TestModeElectionPreset,
                })
              }
              isApplying={isApplying}
            />
          )}
          {families.term && (
            <FamilyRow
              label="term"
              state={families.term}
              onApply={(preset) =>
                onApply({
                  family: 'term',
                  preset: preset as TestModeTermPreset,
                })
              }
              isApplying={isApplying}
            />
          )}
          {families.tenDlc && (
            <FamilyRow
              label="tenDlc"
              state={families.tenDlc}
              onApply={(preset) =>
                onApply({
                  family: 'tenDlc',
                  preset: preset as TestModeTenDlcPreset,
                })
              }
              isApplying={isApplying}
            />
          )}
        </div>
      )}
    </div>
  )
}

interface FamilyRowProps {
  label: string
  state: { current: string | null; available: string[] }
  onApply: (preset: string) => void
  isApplying: boolean
}

function FamilyRow({ label, state, onApply, isApplying }: FamilyRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground w-20 shrink-0">
          {label}
        </span>
        {state.current && (
          <Badge variant="outline" className="text-xs">
            {state.current}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {state.available.map((preset) => (
          <Button
            key={preset}
            variant={preset === state.current ? 'default' : 'outline'}
            size="small"
            className="h-6 px-2 text-xs"
            onClick={() => onApply(preset)}
            disabled={isApplying || preset === state.current}
          >
            {preset}
          </Button>
        ))}
      </div>
    </div>
  )
}
