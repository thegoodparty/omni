'use client'

import { useState, useEffect } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Card,
  Switch,
} from '@styleguide'
import { useUser } from '@shared/hooks/useUser'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { User, UserMetaData } from 'helpers/types'

interface NotificationField {
  key: keyof NotificationSettings
  label: string
  subTitle: string
}

interface NotificationSettings {
  notificationEmails?: boolean
  textNotifications?: boolean
  marketingEmails?: boolean
  weeklyNewsletter?: boolean
}

type CampaignChannel = 'notificationEmails' | 'textNotifications'

const CAMPAIGN_CHANNEL_KEYS: Array<keyof NotificationSettings> = [
  'notificationEmails',
  'textNotifications',
]

const fields: NotificationField[] = [
  {
    key: 'notificationEmails',
    label: 'Campaign emails',
    subTitle: 'Receive notification about your campaign action items',
  },
  {
    key: 'textNotifications',
    label: 'Campaign text messages',
    subTitle: 'Receive text notification about your campaign action items',
  },
  {
    key: 'marketingEmails',
    label: 'Marketing emails',
    subTitle: 'Receive marketing emails from GoodParty.org',
  },
  {
    key: 'weeklyNewsletter',
    label: 'Weekly newsletter',
    subTitle: 'Receive the GoodParty.org newsletter',
  },
]

const isCampaignChannel = (
  key: keyof NotificationSettings,
): key is CampaignChannel => CAMPAIGN_CHANNEL_KEYS.includes(key)

interface NotificationSectionProps {
  // Campaign email/SMS channels are campaign-only; elected officials only see
  // marketing + newsletter.
  showCampaignChannels?: boolean
}

const NotificationSection = ({
  showCampaignChannels = true,
}: NotificationSectionProps): React.JSX.Element => {
  const [user, setUser] = useUser()
  const [state, setState] = useState<NotificationSettings>({})
  const [initialUpdate, setInitialUpdate] = useState(false)
  // Confirmation flow for turning OFF a campaign channel.
  const [pendingToggle, setPendingToggle] = useState<CampaignChannel | null>(
    null,
  )
  const [blockedOpen, setBlockedOpen] = useState(false)

  useEffect(() => {
    if (user && !initialUpdate) {
      let meta: UserMetaData = {}
      try {
        meta = user?.metaData || {}
      } catch (error) {
        console.log('Error parsing user meta', error)
      }

      setState(meta)
      setInitialUpdate(true)
    }
  }, [user])

  const updateUserCallback = async (
    updatedMeta: NotificationSettings,
  ): Promise<void> => {
    try {
      const response = await clientFetch<User>(apiRoutes.user.updateMeta, {
        meta: updatedMeta,
      })
      if (response.data && response.data.id) {
        setUser(response.data)
      }
    } catch (error) {
      console.log('Error updating user', error)
    }
  }

  const applyToggle = (
    key: keyof NotificationSettings,
    checked: boolean,
  ): void => {
    const updatedState = {
      ...state,
      [key]: checked,
    }
    trackEvent(EVENTS.Settings.Notifications.ToggleEmail, {
      email: key,
      enabled: checked,
    })
    setState(updatedState)
    setInitialUpdate(false)
    updateUserCallback(updatedState)
  }

  const handleChange = (
    key: keyof NotificationSettings,
    checked: boolean,
  ): void => {
    // Marketing + newsletter toggle freely.
    if (!isCampaignChannel(key)) {
      applyToggle(key, checked)
      return
    }

    // Turning a campaign channel ON never needs confirmation.
    if (checked) {
      applyToggle(key, true)
      return
    }

    // Turning OFF: GoodParty.org needs at least one campaign channel enabled,
    // so block disabling the last one and confirm disabling the other.
    const otherKey: CampaignChannel =
      key === 'notificationEmails' ? 'textNotifications' : 'notificationEmails'
    // A missing key means the channel renders as off (matches the switch's
    // `?? false` default), so treat it the same here.
    if (!(state[otherKey] ?? false)) {
      setBlockedOpen(true)
    } else {
      setPendingToggle(key)
    }
  }

  const confirmCopy = {
    notificationEmails: {
      title: 'Are you sure you want to turn off campaign emails?',
      description:
        'Disabling the campaign email feature prevents us from notifying you of important campaign milestones, and updates.',
      confirmLabel: 'Turn off emails',
    },
    textNotifications: {
      title: 'Are you sure you want to turn off campaign text messages?',
      description:
        'Disabling the campaign text feature prevents us from notifying you of important campaign milestones, and updates.',
      confirmLabel: 'Turn off texts',
    },
  } as const

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <h2 className="m-0 text-xl font-semibold text-foreground">
        Notifications
      </h2>

      {fields
        .filter(
          (field) =>
            showCampaignChannels || !CAMPAIGN_CHANNEL_KEYS.includes(field.key),
        )
        .map((field) => (
          <div
            className="flex items-center justify-between gap-8 py-1"
            key={field.key}
          >
            <div className="flex flex-col gap-0.5">
              <p className="m-0 text-base font-medium text-foreground">
                {field.label}
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                {field.subTitle}
              </p>
            </div>
            <Switch
              onCheckedChange={(checked) => handleChange(field.key, checked)}
              checked={state[field.key] ?? false}
            />
          </div>
        ))}

      {/* Confirm turning OFF a campaign channel */}
      <AlertDialog
        open={pendingToggle !== null}
        onOpenChange={(open) => {
          if (!open) setPendingToggle(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingToggle ? confirmCopy[pendingToggle].title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingToggle ? confirmCopy[pendingToggle].description : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingToggle) applyToggle(pendingToggle, false)
                setPendingToggle(null)
              }}
            >
              {pendingToggle ? confirmCopy[pendingToggle].confirmLabel : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block disabling the last remaining campaign channel */}
      <AlertDialog open={blockedOpen} onOpenChange={setBlockedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep at least one channel on</AlertDialogTitle>
            <AlertDialogDescription>
              We need at least one way to reach you about important campaign
              milestones and updates. Turn on campaign emails or text messages
              before disabling the other.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlockedOpen(false)}>
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export default NotificationSection
