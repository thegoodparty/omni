import { SocialAssetKind, SocialAssetPlatform } from '../../generated/prisma'

export const SOCIAL_PLATFORM_KIND: Record<
  SocialAssetPlatform,
  SocialAssetKind
> = {
  [SocialAssetPlatform.facebook]: SocialAssetKind.post_copy,
  [SocialAssetPlatform.instagram]: SocialAssetKind.post_copy,
  [SocialAssetPlatform.nextdoor]: SocialAssetKind.post_copy,
  [SocialAssetPlatform.x]: SocialAssetKind.post_copy,
  [SocialAssetPlatform.tiktok]: SocialAssetKind.video_script,
  [SocialAssetPlatform.youtube_shorts]: SocialAssetKind.video_script,
}
