'use client'

import { useState, useMemo } from 'react'
import TextField from '../../shared/inputs/TextField'
import EmailInput from '../../shared/inputs/EmailInput'
import PhoneInput from '../../shared/inputs/PhoneInput'
import Checkbox from '../../shared/inputs/Checkbox'
import Button from '../../shared/buttons/Button'
import { Website, WebsiteTheme } from '../types/website.type'
import { Element } from 'react-scroll'
import { WEBSITE_SECTIONS } from '../constants/websiteNavigation.const'
import formatPhoneNumber, { phoneUri } from '../../shared/utils/phoneFormatter'

async function submitContactForm(vanityPath: string, formData: any) {
  const response = await fetch(`/api/contact-form/${vanityPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData),
  })

  if (!response.ok) {
    throw new Error('Failed to submit contact form')
  }

  return response.json()
}

interface ContactSectionProps {
  activeTheme: WebsiteTheme
  content: Website['content']
  vanityPath: string
  onPrivacyPolicyClick: () => void
}

interface FormData {
  name?: string
  email?: string
  phone?: string
  message?: string
  smsConsent: boolean
}

export default function ContactSection({
  activeTheme,
  content,
  vanityPath,
  onPrivacyPolicyClick,
}: ContactSectionProps) {
  const [formData, setFormData] = useState<FormData>({
    smsConsent: false,
  })
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const muiInputSx = useMemo(() => {
    const color = activeTheme.muiColor
    return {
      '& label': { color },
      '& label.Mui-focused': { color },
      '& .MuiOutlinedInput-root': {
        color,
        '& fieldset': { borderColor: color },
        '&:hover fieldset': { borderColor: color },
        '&.Mui-focused fieldset': { borderColor: color },
      },
    }
  }, [activeTheme.muiColor])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await submitContactForm(vanityPath, formData)
      setSubmitted(true)
    } catch (error) {
      console.error('Failed to submit contact form:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleChange(name: string, value: string | boolean) {
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  return (
    <section
      className={`py-32 ${activeTheme.secondary} scroll-mt-16`}
      id="contact"
    >
      <div className="max-w-2xl mx-auto px-8 text-center">
        <Element name={WEBSITE_SECTIONS.CONTACT}>
        <h2 className="font-semibold text-2xl mb-2">Send Me a Message</h2>
        <p className="mb-6">
          Have questions or suggestions? I would love to hear from you!
        </p>

        {submitted ? (
          <div
            className={`p-6 rounded-lg text-center ${activeTheme.secondary} ${activeTheme.text} ${activeTheme.border}`}
          >
            Thank you for your message!
          </div>
        ) : (
          <form
            className={`p-8 rounded-lg ${activeTheme.bg} ${activeTheme.text} shadow-sm space-y-6`}
            onSubmit={handleSubmit}
          >
            <div className="mb-4">
              <TextField
                value={formData.name || ''}
                label="Your Name"
                name="name"
                fullWidth
                required
                placeholder="John Doe"
                onChange={(e) => handleChange('name', e.target.value)}
                sx={muiInputSx}
                InputLabelProps={{ shrink: true }}
              />
            </div>
            <div className="mb-4">
              <EmailInput
                value={formData.email || ''}
                required
                placeholder="john@example.com"
                onChangeCallback={(e) => handleChange('email', e.target.value)}
                sx={muiInputSx}
                InputLabelProps={{ shrink: true }}
              />
            </div>
            <div className="mb-4">
              <PhoneInput
                value={formData.phone || ''}
                hideIcon
                shrink
                onChangeCallback={(phone) => handleChange('phone', phone)}
                sx={muiInputSx}
                InputLabelProps={{ shrink: true }}
              />
            </div>
            <div className="mb-4">
              <TextField
                value={formData.message || ''}
                label="Message"
                name="message"
                fullWidth
                required
                multiline
                rows={4}
                placeholder="How can we help you?"
                onChange={(e) => handleChange('message', e.target.value)}
                sx={muiInputSx}
                InputLabelProps={{ shrink: true }}
              />
            </div>
            <div className="flex items-start space-x-2">
              <Checkbox
                checked={formData.smsConsent}
                onChange={(e) =>
                  handleChange('smsConsent', e.target.checked === true)
                }
                theme={{
                  muiColor: activeTheme.muiColor
                }}
              />
              <label htmlFor="sms-consent" className="text-xs text-left">
                By providing your number, you consent to receive campaign texts
                (msg freq varies, msg/data rates apply). Your data will not be
                shared with third parties for marketing. Reply STOP to opt out,
                HELP for help. See our{' '}
                <button
                  type="button"
                  className="text-blue-600 underline hover:text-blue-700"
                  onClick={(e) => {
                    e.preventDefault()
                    onPrivacyPolicyClick()
                  }}
                >
                  Privacy Policy
                </button>{' '}
                for details.
              </label>
            </div>
            <div className="mt-4">
              <Button
                type="submit"
                disabled={
                  loading ||
                  !formData.name ||
                  !formData.email ||
                  !formData.message ||
                  !formData.smsConsent
                }
                loading={loading}
                color="primary"
                size="large"
                theme={{
                  accent: activeTheme.accent,
                  accentText: activeTheme.accentText
                }}
              >
                Send Message
              </Button>
            </div>
          </form>
        )}
  </Element>
  <Element name={WEBSITE_SECTIONS.CONTACT_INFO}>
        <div className="mt-8 text-center">
          <p className="font-medium">Campaign Headquarters</p>
          <p className="mt-1">{content?.contact?.address || ''}</p>
          {content?.contact?.email && (
          <p className="mt-1">
            <a href={`mailto:${content.contact.email}`} className="hover:text-blue-600 underline ">
              {content.contact.email}
              </a>
          </p>
        )}
          {content?.contact?.phone && (
          <p className="mt-1">
            <a href={phoneUri(content.contact.phone)} className="hover:text-blue-600 underline ">
              {formatPhoneNumber(content.contact.phone)}
              </a>
          </p>
          )}
        </div>
        </Element>
      </div>
    </section>
  )
}
