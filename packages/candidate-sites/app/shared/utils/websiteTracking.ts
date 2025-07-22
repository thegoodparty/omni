import { fetchHelper } from "@/helpers/fetchHelper"

export const getVisitorId = () => {
  let visitorId = localStorage.getItem('visitor_id')
  if (!visitorId) {
    visitorId = crypto.randomUUID()
    localStorage.setItem('visitor_id', visitorId)
  }
  return visitorId
}

export const trackWebsiteView = async (vanityPath: string) => {
  const sessionKey = `viewed_${vanityPath}`
  const hasViewed = sessionStorage.getItem(sessionKey)

  if (!hasViewed) {
    try {
      await fetchHelper(`websites/${vanityPath}/track-view`, {
        method: 'POST',
        body: {
          visitorId: getVisitorId(),
        },
      })
      sessionStorage.setItem(sessionKey, 'true')
    } catch (error) {
      console.warn('Failed to track view:', error)
    }
  }
}
