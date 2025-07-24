'use client'
import { useState } from 'react'
import { WEBSITE_THEMES } from '../constants/websiteContent.const'
import { Website } from '../types/website.type'
import WebsiteHeader from './WebsiteHeader'
import HeroSection from './HeroSection'
import AboutSection from './AboutSection'
import PrivacyPolicyModal from './PrivacyPolicyModal'
import WebsiteFooter from './WebsiteFooter'
import ContactSection from './ContactSection'
import { getUserFullName } from '@/app/shared/utils/getUserFullName'
import WebsiteViewTracker from './WebsiteViewTracker'

export default function WebsitePage({ website, scale = 1, isPreview = false }: { website: Website, scale?: number, isPreview?: boolean }) {
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  const content = website?.content || {}
  const activeTheme = WEBSITE_THEMES[content?.theme as keyof typeof WEBSITE_THEMES] || WEBSITE_THEMES.light

  const candidateName = getUserFullName(website.campaign?.user)

  return (
    <div
      className={`${activeTheme.bg} ${activeTheme.text} ${isPreview ? 'pointer-events-none' : '' }`}
      style={{
        zoom: scale,
      }}
    >
       <WebsiteViewTracker vanityPath={website.vanityPath} />
      <WebsiteHeader activeTheme={activeTheme} website={website} />
      <HeroSection activeTheme={activeTheme} content={content} />
       <AboutSection activeTheme={activeTheme} content={content} />
      <ContactSection
        activeTheme={activeTheme}
        content={content}
        vanityPath={website.vanityPath}
        onPrivacyPolicyClick={() => setShowPrivacyPolicy(true)}
      />
      <WebsiteFooter
        activeTheme={activeTheme}
        onPrivacyPolicyClick={() => setShowPrivacyPolicy(true)}
        committee={content.about?.committee || candidateName}
      />
      <PrivacyPolicyModal
        open={showPrivacyPolicy}
        onClose={() => setShowPrivacyPolicy(false)}
        content={content}
      />
    </div>
  )
}
