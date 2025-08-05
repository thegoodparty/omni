'use client'

import Image from 'next/image'
import Button from '@/app/shared/buttons/Button'
import { Link } from 'react-scroll'
import { WEBSITE_SECTIONS } from '../constants/websiteNavigation.const'
import { ImageDimensions } from '@/app/shared/utils/getImageDimensions'

export default function HeroSection({
  activeTheme,
  content,
  imageDimensions,
}: {
  activeTheme: any
  content: any
  imageDimensions?: ImageDimensions
}) {
  const hasImage = content?.main?.image
  const imageWidth = imageDimensions?.width || 1280
  const imageHeight = imageDimensions?.height || 640

  const FULL_WIDTH_IMAGE_THRESHOLD = 300

  return (
    <section className={`py-16 ${activeTheme.secondary}`}>
      <div className="max-w-6xl mx-auto px-8 flex-col md:flex-row flex gap-16 justify-between items-stretch md:items-center">
        <div
          className={`grow lg:min-w-96 md:w-1/2 ${
            !hasImage ? 'text-center' : 'text-center md:text-left'
          }`}
        >
          <h1 className="font-bold text-4xl md:text-6xl mb-2 md:mb-4">
            {content?.main?.title || ''}
          </h1>
          <p className="text-xl mb-8">{content?.main?.tagline || ''}</p>
          <Link to={WEBSITE_SECTIONS.CONTACT}  smooth duration={500}>
            <Button
              className={`inline-block`}
              color="primary"
              size="large"
              theme={{
                accent: activeTheme.accent,
                accentText: activeTheme.accentText
              }}
            >
              Send a Message
            </Button>
          </Link>
        </div>
        {hasImage && (
          <div className="w-full overflow-hidden shrink md:w-1/2">
            <Image
              src={content?.main?.image}
              alt="Campaign Hero"
              className={`mx-auto rounded-lg`}
              height={imageHeight}
              width={imageWidth}
              priority
            />
          </div>
        )}
      </div>
    </section>
  )
}
