'use client'
import { useState } from 'react'
import { WEBSITE_THEMES } from '../constants/websiteContent.const'
import { Website } from '../types/website.type'
import WebsiteHeader from './WebsiteHeader'
import HeroSection from './HeroSection'
import AboutSection from './AboutSection'
// import PrivacyPolicyModal from './PrivacyPolicyModal'
// import WebsiteFooter from './WebsiteFooter'
// import ContactSection from './ContactSection'
// import AboutSection from './AboutSection'
// import HeroSection from './HeroSection'

export default function WebsitePage({ website, scale = 1 }: { website: Website, scale?: number }) {
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  const content = website?.content || {}
  const activeTheme = WEBSITE_THEMES[content?.theme as keyof typeof WEBSITE_THEMES] || WEBSITE_THEMES.light

  return (
    <div
      className={`${activeTheme.bg} ${activeTheme.text}`}
      style={{
        zoom: scale,
      }}
    >
      <WebsiteHeader activeTheme={activeTheme} website={website} />
      <HeroSection activeTheme={activeTheme} content={content} />
       <AboutSection activeTheme={activeTheme} content={content} />
       {/*
      <ContactSection
        activeTheme={activeTheme}
        content={content}
        vanityPath={website.vanityPath}
        onPrivacyPolicyClick={() => setShowPrivacyPolicy(true)}
      />
      <WebsiteFooter
        activeTheme={activeTheme}
        onPrivacyPolicyClick={() => setShowPrivacyPolicy(true)}
      />
      <PrivacyPolicyModal
        open={showPrivacyPolicy}
        onClose={() => setShowPrivacyPolicy(false)}
        content={content}
      /> */}
    </div>
  )
}
