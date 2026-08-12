import type { ReactNode } from 'react'
import type {
  SocialAssetKind,
  SocialAssetPlatform,
} from '@goodparty_org/contracts'
import {
  FacebookIcon,
  InstagramIcon,
  UsersIcon,
  VideoIcon,
  YoutubeIcon,
} from '@styleguide/components/ui/icons'
import { TwitterLogo } from '@shared/brand-logos'

export interface SocialPlatformMeta {
  id: SocialAssetPlatform
  label: string
  helper: string
  icon: ReactNode
  kind: SocialAssetKind
}

// One tile per destination. "post_copy" = post text, "video_script" = video
// teleprompter + caption. `kind` here is display-only — the server derives
// the persisted kind from the platform and never trusts the client's.
export const SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    helper: 'Post copy',
    icon: <FacebookIcon className="size-5" />,
    kind: 'post_copy',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    helper: 'Post copy',
    icon: <InstagramIcon className="size-5" />,
    kind: 'post_copy',
  },
  {
    id: 'nextdoor',
    label: 'Nextdoor',
    helper: 'Post copy',
    icon: <UsersIcon className="size-5" />,
    kind: 'post_copy',
  },
  {
    id: 'x',
    label: 'X',
    helper: 'Post copy',
    icon: <TwitterLogo size={20} />,
    kind: 'post_copy',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    helper: 'Video script',
    icon: <VideoIcon className="size-5" />,
    kind: 'video_script',
  },
  {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    helper: 'Video script',
    icon: <YoutubeIcon className="size-5" />,
    kind: 'video_script',
  },
]

export const ALL_SOCIAL_PLATFORM_IDS: SocialAssetPlatform[] =
  SOCIAL_PLATFORMS.map((p) => p.id)

export const socialPlatformMeta = (
  platform: SocialAssetPlatform,
): SocialPlatformMeta =>
  SOCIAL_PLATFORMS.find((p) => p.id === platform) ?? {
    id: platform,
    label: platform,
    helper: 'Post copy',
    icon: null,
    kind: 'post_copy',
  }
