'use client'

import { useState, useMemo } from 'react'
import H2 from '../../shared/typography/H2'
import TextField from '../../shared/inputs/TextField'
import EmailInput from '../../shared/inputs/EmailInput'
import PhoneInput from '../../shared/inputs/PhoneInput'
import Checkbox from '../../shared/inputs/Checkbox'
import Button from '../../shared/buttons/Button'
import { Website, WebsiteTheme } from '../types/website.type'
import { Element } from 'react-scroll'
import { WEBSITE_SECTIONS } from '../constants/websiteNavigation.const'

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
      className={`mx-auto max-w-4xl py-10 px-4 ${activeTheme.bg} scroll-mt-16`}
      id="contact"
    >
      <Element name={WEBSITE_SECTIONS.CONTACT}>
      <H2 className="mb-4">Send a Message</H2>
      <p className="mb-6">
        Have questions or suggestions? We&apos;d love to hear from you!
      </p>

      {submitted ? (
        <div
          className={`p-6 rounded-lg text-center ${activeTheme.secondary} ${activeTheme.text} ${activeTheme.border}`}
        >
          Thank you for your message!
        </div>
      ) : (
        <form
          className={`p-6 rounded-lg ${activeTheme.secondary} ${activeTheme.text} shadow-sm space-y-4`}
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
              required
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
            />
            <label htmlFor="sms-consent" className="text-xs">
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
                !formData.phone ||
                !formData.message ||
                !formData.smsConsent
              }
              loading={loading}
              color="primary"
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
        <p className="mt-1">{content?.contact?.email || ''}</p>
        <p className="mt-1">{content?.contact?.phone || ''}</p>
      </div>
      </Element>
    </section>
  )
}
