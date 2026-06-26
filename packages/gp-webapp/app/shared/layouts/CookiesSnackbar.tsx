'use client'
import { getCookie, setCookie } from 'helpers/cookieHelper'
import { useEffect, useState } from 'react'
import { isbot } from 'isbot'
import { MdClose } from 'react-icons/md'
import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'

const CookiesSnackbar = (): React.JSX.Element | null => {
  const [showBanner, setShowBanner] = useState(false)
  useEffect(() => {
    const cookie = getCookie('cookiesAccepted')
    const isBot = isbot(navigator.userAgent)
    if (!cookie && !isBot && !navigator.webdriver) {
      setShowBanner(true)
    }
  }, [])
  if (!showBanner) {
    return null
  }
  const handleAccept = () => {
    setCookie('cookiesAccepted', 'true', 365)
    setShowBanner(false)
  }
  return (
    <div className="fixed bottom-4 flex justify-center w-full pointer-events-none">
      <div
        className="bg-tertiary-light text-tertiary-dark p-4 flex max-w-[440px] mx-8 rounded-lg pointer-events-auto"
        data-testid="cookie-snackbar"
      >
        <Body2>
          By continuing to browse this site, you consent to the use of cookies.
        </Body2>
        <Button
          className="ml-6 self-center"
          variant="outline"
          size="medium"
          onClick={handleAccept}
          data-testid="cookie-accept-btn"
        >
          Close
          <MdClose className="ml-2 text-xl" />
        </Button>
      </div>
    </div>
  )
}

export default CookiesSnackbar
