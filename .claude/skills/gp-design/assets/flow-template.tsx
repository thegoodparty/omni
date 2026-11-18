// One option's flow, drawn with the real styleguide components. Copy this file to
// <work>/flow/option-a.tsx (option-b.tsx, option-c.tsx on the options page) and
// replace every sample. reference/wireframe-build.md says how to draw; check.py
// runs the rules.
//
// Import only from react, gp-flow and the styleguide (@styleguide/components/ui/<name>
// or @styleguide). Icons come from @styleguide/components/ui/icons, the logo is
// GoodPartyOrgLogo. Never a raw <button>, <input>, <select>, <textarea>, <a> or <svg>.
//
// The frame stands in for the window: lg: and useIsMobile switch at the frame's
// width, so one flow draws the phone (375 on the page) and the desktop (the
// Desktop preview tab). Copy a screen's classes from its source as they are.
import { Button } from '@styleguide/components/ui/button'
import { Input } from '@styleguide/components/ui/input'
import { Label } from '@styleguide/components/ui/label'
import { GoodPartyOrgLogo } from '@styleguide/components/ui/good-party-org-logo'
import type { Screens, States } from 'gp-flow'

// The flow step title, copied from Intro.tsx in app/dashboard/outreach/v2/social.
const Intro = ({ title, body }: { title: string; body: string }) => (
  <div
    className="space-y-2"
    data-source="packages/gp-webapp/app/dashboard/outreach/v2/social/Intro.tsx:14"
  >
    <h3 className="text-2xl font-semibold text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{body}</p>
  </div>
)

// The flow footer: OutreachSheet.tsx's footer around OutreachFlowShell.tsx's button row, Back on
// the left and the main action on the right. Copy the visual order, not the DOM order.
const Footer = ({
  back,
  next,
  label,
}: {
  back: string
  next: string
  label: string
}) => (
  <div
    className="shrink-0 border-t border-border bg-background px-6 py-4"
    data-source="packages/gp-webapp/app/dashboard/outreach/v2/OutreachSheet.tsx:186"
  >
    <div className="mx-auto flex w-full max-w-[608px] flex-col gap-2">
      <div className="flex w-full flex-row-reverse items-center justify-between gap-3">
        <Button
          size="large"
          className="min-w-0 flex-1 lg:min-w-[240px] lg:flex-none"
          data-source="packages/gp-webapp/app/dashboard/outreach/v2/OutreachFlowShell.tsx:281"
          data-go={next}
        >
          {label}
        </Button>
        <Button
          size="large"
          variant="ghost"
          className="shrink-0 lg:min-w-[140px]"
          data-source="packages/gp-webapp/app/dashboard/outreach/v2/OutreachFlowShell.tsx:307"
          data-go={back}
        >
          Back
        </Button>
      </div>
    </div>
  </div>
)

export const screens: Screens = {
  // Where the user starts: copy the real page from its source. Never a gray block.
  entry: () => (
    <div className="flex min-h-dvh flex-col">
      <div
        className="flex lg:hidden items-center justify-between h-16 px-4 bg-sidebar border-b border-sidebar-border"
        data-source="packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx:296"
      >
        <div className="flex items-center gap-3 min-w-0">
          <GoodPartyOrgLogo size="small" />
          <span className="truncate text-base font-semibold">
            Context label
          </span>
        </div>
      </div>
      <div className="flex-1 p-6">
        <Button size="large" data-go="1">
          The button that starts the flow
        </Button>
      </div>
    </div>
  ),
  // A full-screen flow step: no dashboard top bar, the body scrolls, the footer stays at the bottom.
  '1': () => (
    <div className="flex h-dvh flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <Intro
          title="Which office did you win, Sarah?"
          body="Pick the seat you hold today."
        />
        <div className="space-y-2">
          <Label htmlFor="a-office">Office</Label>
          <Input id="a-office" defaultValue="City council, Maplewood" />
        </div>
      </div>
      <Footer back="entry" next="2" label="Confirm office" />
    </div>
  ),
  '2': () => (
    <div className="p-6">
      <Intro
        title="Landing state"
        body="What the user sees when the flow is done."
      />
    </div>
  ),
}

// Other states: every state the build will need, each one screen with a one-line label.
export const states: States = {
  error: {
    label: 'State label',
    screen: () => <div className="p-6">State screen</div>,
  },
}
