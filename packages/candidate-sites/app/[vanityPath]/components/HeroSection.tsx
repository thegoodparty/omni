'use client'

import Image from 'next/image'
import Button from '@/app/shared/buttons/Button'

export default function HeroSection({
  activeTheme,
  content,
}: {
  activeTheme: any
  content: any
}) {
  const hasImage = content?.main?.image
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
          <Button
            href="#contact"
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
        </div>
        {hasImage && (
          <div className="w-full rounded-lg overflow-hidden shrink md:w-1/2">
            <Image
              src={content?.main?.image}
              alt="Campaign Hero"
              className="w-full"
              height={640}
              width={1280}
            />
          </div>
        )}
      </div>
    </section>
  )
}
