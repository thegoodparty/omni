'use client'
import { useState, useEffect } from 'react'
import { animateScroll as scroll, scroller } from 'react-scroll'
import { WEBSITE_THEMES } from '../constants/websiteContent.const'
import { WEBSITE_SECTIONS, WEBSITE_STEPS } from '../constants/websiteNavigation.const'
import { Website } from '../types/website.type'
import WebsiteHeader from './WebsiteHeader'
import HeroSection from './HeroSection'
import AboutSection from './AboutSection'
import PrivacyPolicyModal from './PrivacyPolicyModal'
import WebsiteFooter from './WebsiteFooter'
import ContactSection from './ContactSection'
import { getUserFullName } from '@/app/shared/utils/getUserFullName'
import WebsiteViewTracker from './WebsiteViewTracker'

const scrollSettings = {
  duration: 800,
  delay: 0,
  smooth: 'easeInOutQuart',
}

export default function WebsitePage({
  website,
  scale = 1,
  isPreview = false,
  step,
}: {
  website: Website
  scale?: number
  isPreview?: boolean
  step?: number | null
}) {
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false)
  const content = website?.content || {}
  const activeTheme =
    WEBSITE_THEMES[content?.theme as keyof typeof WEBSITE_THEMES] ||
    WEBSITE_THEMES.light

  const candidateName = getUserFullName(website.campaign?.user)

  useEffect(() => {
    if (!isPreview || step === null || step === undefined) return

    const scrollToSection = () => {
      if ( step === WEBSITE_STEPS.CONTACT_INTRO) {
        scroller.scrollTo(WEBSITE_SECTIONS.ABOUT, {
          ...scrollSettings,
        })
      } else if (step === WEBSITE_STEPS.CONTACT_INFO) {
        scroller.scrollTo(WEBSITE_SECTIONS.CONTACT_INFO, {
          ...scrollSettings,
        })
      } else {
        scroll.scrollToTop({
          ...scrollSettings,
        })
      }
    }

    const timer = setTimeout(scrollToSection, 200)
    return () => clearTimeout(timer)
  }, [step, isPreview])

  return (
    <div
      className={`${activeTheme.bg} ${activeTheme.text} ${
        isPreview ? 'pointer-events-none' : ''
      }`}
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
