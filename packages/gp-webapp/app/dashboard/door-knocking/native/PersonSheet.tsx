'use client'

import {
  DoorKnockStatus,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { IconButton, MapPinIcon, XMarkIcon } from '@styleguide'
import RecordKnockForm from './RecordKnockForm'
import DoorScript from './DoorScript'
import { useDoorScript } from './useDoorScript'
import DoNotKnockControl from './DoNotKnockControl'
import { STATUS_DOT_COLORS, STATUS_LABELS } from './statusPresentation'

const StatusDot = ({ status }: { status: DoorKnockStatus }) => (
  <span
    className="h-2 w-2 shrink-0 rounded-full"
    style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
  />
)

interface PersonSheetProps {
  stop: RoutePayloadStop
  // Controlled by WalkView rather than held here, because auto-advance moves
  // between residents of one household without the sheet closing — internal
  // state would keep showing the person who was just logged.
  selectedTargetId: number
  onSelectTarget: (targetId: number) => void
  statusFor: (target: RoutePayloadTarget) => DoorKnockStatus
  clientKeyFor: (targetId: number) => string
  onRecorded: (
    targetId: number,
    personId: string,
    knockStatus: DoorKnockStatus,
  ) => void
  onDoNotKnockChanged: (personId: string, doNotKnock: boolean) => void
  onClose: () => void
}

// The demo's person sheet: a right panel on desktop, a bottom sheet on
// small screens. Talking points are the candidate's own saved issues, not the
// AI copy the demo implied.
//
// Phones are live-only and screen-only. The route payload carries them for a
// target that still has a live row, which is the same rule mayHaveMoved is
// derived from — so a mover shows no number rather than one belonging to
// whoever lives there now. They are deliberately absent from the printed walk
// sheet, which leaves the building.
const digitsOnly = (phone: string): string => phone.replace(/\D/g, '')

const PhoneRow = ({ label, phone }: { label: string; phone: string }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    {/* Tappable: the point of a number at the door is calling it from the
        phone already in the canvasser's hand. */}
    <a className="underline" href={`tel:${digitsOnly(phone)}`}>
      {phone}
    </a>
  </div>
)

export default function PersonSheet({
  stop,
  selectedTargetId,
  onSelectTarget,
  statusFor,
  clientKeyFor,
  onRecorded,
  onDoNotKnockChanged,
  onClose,
}: PersonSheetProps) {
  const targets = stop.addresses.flatMap((address) => address.targets)
  const script = useDoorScript()
  const target =
    targets.find((candidate) => candidate.stopTargetId === selectedTargetId) ??
    targets[0]
  if (!target) return null
  const otherResidents = stop.addresses.flatMap(
    (address) => address.otherResidents,
  )

  return (
    <>
      <button
        type="button"
        aria-label="Close person details"
        className="fixed inset-0 z-30 bg-foreground/20"
        onClick={onClose}
      />
      <div className="fixed z-40 flex flex-col bg-background shadow-xl max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[85dvh] max-lg:rounded-t-xl lg:bottom-0 lg:right-0 lg:top-0 lg:w-[430px] lg:border-l lg:border-border">
        <div className="flex items-start gap-3 border-b border-border p-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-info text-sm font-semibold text-primary-foreground">
            {stop.seq}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold">
              {target.name ?? 'Name unavailable'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {[
                target.age !== null ? `${target.age} years old` : null,
                target.politicalParty,
              ]
                .filter(Boolean)
                .join(' · ') || 'No details on file'}
            </p>
          </div>
          <IconButton aria-label="Close person details" onClick={onClose}>
            <XMarkIcon size={18} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {targets.length > 1 && (
            <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-lg bg-muted p-1.5">
              {targets.map((candidate) => (
                <button
                  key={candidate.stopTargetId}
                  type="button"
                  aria-pressed={candidate.stopTargetId === target.stopTargetId}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                    candidate.stopTargetId === target.stopTargetId
                      ? 'border border-border bg-background font-medium shadow-sm'
                      : ''
                  }`}
                  onClick={() => onSelectTarget(candidate.stopTargetId)}
                >
                  {candidate.name ?? 'Unnamed'}
                  <StatusDot status={statusFor(candidate)} />
                </button>
              ))}
            </div>
          )}

          <section className="mb-4 rounded-lg border border-border">
            <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Contact information
            </h3>
            <div className="flex flex-col gap-3 p-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Address</p>
                <p>{stop.displayAddress}</p>
              </div>
              {target.cellPhone && (
                <PhoneRow label="Cell phone" phone={target.cellPhone} />
              )}
              {target.landline && (
                <PhoneRow label="Landline" phone={target.landline} />
              )}
              {/* Only meaningful for someone we still have a live row for: a
                  mover has no number because the row is gone, not because the
                  file lacks one, and the moved warning below says so. */}
              {!target.cellPhone &&
                !target.landline &&
                !target.mayHaveMoved && (
                  <p className="text-xs text-muted-foreground">
                    No phone number on file.
                  </p>
                )}
              <a
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                href={`https://maps.google.com/?q=${stop.lat},${stop.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPinIcon size={16} /> Open in Maps
              </a>
              {target.mayHaveMoved && (
                <p className="text-xs text-warning">
                  May have moved since this route was built.
                </p>
              )}
            </div>
          </section>

          <section className="mb-4 rounded-lg border border-border">
            <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
              Household
            </h3>
            <div className="flex flex-col gap-2 p-4 text-sm">
              {targets.map((member) => (
                <div
                  key={member.stopTargetId}
                  className="flex items-center justify-between"
                >
                  <span className="truncate">
                    {member.name ?? 'Name unavailable'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusDot status={statusFor(member)} />
                    {STATUS_LABELS[statusFor(member)]}
                  </span>
                </div>
              ))}
              {otherResidents.map((resident, index) => (
                <div
                  key={`${resident.name ?? 'resident'}-${index}`}
                  className="flex items-center justify-between text-muted-foreground"
                >
                  <span className="truncate">
                    {resident.name ?? 'Resident'}
                  </span>
                  <span className="text-xs">Not targeted</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-border p-4">
          {/* ADR 0007. The script and the form are withheld rather than
              disabled: a flagged door has nothing to say and nothing to log,
              and an inert set of pills invites someone to work out why they
              don't respond. */}
          {target.doNotKnock ? (
            <DoNotKnockControl
              key={target.stopTargetId}
              target={target}
              onChanged={onDoNotKnockChanged}
            />
          ) : (
            <>
              {/* Above the form, because it's what the canvasser says before
                  there is anything to log. */}
              <DoorScript intro={script.intro} issues={script.issues} />
              <h3 className="text-base font-semibold">Log this door</h3>
              <RecordKnockForm
                key={target.stopTargetId}
                target={target}
                clientKey={clientKeyFor(target.stopTargetId)}
                onRecorded={(personId, knockStatus) =>
                  onRecorded(target.stopTargetId, personId, knockStatus)
                }
              />
              {/* Namespaced: a bare stopTargetId would collide with the
                  form's key above, and React reconciles same-key siblings as
                  one child. Both still need a key so each resets its mutation
                  state when the canvasser switches resident. */}
              <DoNotKnockControl
                key={`do-not-knock-${target.stopTargetId}`}
                target={target}
                onChanged={onDoNotKnockChanged}
              />
            </>
          )}
        </div>
      </div>
    </>
  )
}
