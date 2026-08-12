'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SocialAsset } from '@goodparty_org/contracts'
import { Button, Card, Label, Textarea } from '@styleguide'
import { CopyIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import { useSnackbar } from 'helpers/useSnackbar'
import { copyTextToClipboard } from './copyText.util'
import { socialPlatformMeta } from './socialPlatforms'

const PlatformChip = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <span className="flex items-center gap-2">
    <span className="flex size-7 items-center justify-center rounded-full bg-secondary-light text-foreground">
      {icon}
    </span>
    <span className="text-sm font-semibold text-foreground">{label}</span>
  </span>
)

// Clipboard-denied fallback (implementation notes edge case): a readonly,
// pre-selected textarea the user can copy from manually.
const ManualCopyField = ({ text }: { text: string }) => {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.select()
  }, [])
  return (
    <div className="space-y-1">
      <Textarea
        ref={ref}
        readOnly
        value={text}
        onFocus={(e) => e.target.select()}
        className="min-h-[120px]"
      />
      <p className="text-xs text-muted-foreground">
        Press {navigator.platform?.includes('Mac') ? '⌘C' : 'Ctrl+C'} to copy
      </p>
    </div>
  )
}

const useCopy = () => {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [manualCopyText, setManualCopyText] = useState<string | null>(null)
  const copy = async (text: string, label: string) => {
    if (await copyTextToClipboard(text)) {
      successSnackbar(label)
      setManualCopyText(null)
      return
    }
    errorSnackbar('Copy failed', {
      description: 'Select the text below and copy it manually.',
    })
    setManualCopyText(text)
  }
  return { copy, manualCopyText }
}

const CopyButton = ({
  onClick,
  children = 'Copy',
}: {
  onClick: () => void
  children?: ReactNode
}) => (
  <Button type="button" size="small" variant="outline" onClick={onClick}>
    <CopyIcon className="size-4" />
    {children}
  </Button>
)

const CopyCard = ({ asset }: { asset: SocialAsset }) => {
  const meta = socialPlatformMeta(asset.platform)
  const { copy, manualCopyText } = useCopy()
  const { errorSnackbar } = useSnackbar()

  const postToX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(asset.text)}`
    const win = window.open(url, '_blank', 'width=600,height=600')
    if (!win) {
      errorSnackbar('Popup blocked', {
        description: 'Allow popups for this site to post to X.',
      })
    }
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlatformChip icon={meta.icon} label={meta.label} />
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            onClick={() => copy(asset.text, `Copied ${meta.label} post`)}
          />
          {asset.platform === 'x' && (
            <Button
              type="button"
              size="small"
              variant="outline"
              onClick={postToX}
            >
              <XMarkIcon className="size-4" />
              Post
            </Button>
          )}
        </div>
      </div>
      {manualCopyText !== null ? (
        <ManualCopyField text={manualCopyText} />
      ) : (
        <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">
          {asset.text}
        </p>
      )}
    </Card>
  )
}

const ScriptCard = ({ asset }: { asset: SocialAsset }) => {
  const meta = socialPlatformMeta(asset.platform)
  const { copy, manualCopyText } = useCopy()

  return (
    <Card className="gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <PlatformChip icon={meta.icon} label={meta.label} />
          <span className="text-xs text-muted-foreground">Read on camera</span>
        </span>
        <CopyButton
          onClick={() => copy(asset.text, `Copied ${meta.label} script`)}
        />
      </div>

      {manualCopyText !== null ? (
        <ManualCopyField text={manualCopyText} />
      ) : (
        <div className="rounded-2xl bg-muted p-5">
          <p className="text-lg leading-8 font-medium whitespace-pre-wrap text-foreground">
            {asset.text}
          </p>
        </div>
      )}

      {asset.caption && (
        <CaptionBlock caption={asset.caption} platformLabel={meta.label} />
      )}
    </Card>
  )
}

const CaptionBlock = ({
  caption,
  platformLabel,
}: {
  caption: string
  platformLabel: string
}) => {
  const { copy, manualCopyText } = useCopy()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-muted-foreground">
          Caption
        </Label>
        <CopyButton
          onClick={() => copy(caption, `Copied ${platformLabel} caption`)}
        >
          Copy caption
        </CopyButton>
      </div>
      {manualCopyText !== null ? (
        <ManualCopyField text={manualCopyText} />
      ) : (
        <p className="rounded-2xl border border-border bg-background p-3 text-sm leading-6 whitespace-pre-wrap text-foreground">
          {caption}
        </p>
      )}
    </div>
  )
}

export const SocialAssetCard = ({ asset }: { asset: SocialAsset }) =>
  asset.kind === 'video_script' ? (
    <ScriptCard asset={asset} />
  ) : (
    <CopyCard asset={asset} />
  )
