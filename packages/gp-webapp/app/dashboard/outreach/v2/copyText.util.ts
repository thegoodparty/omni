// navigator.clipboard is unavailable or permission-denied on some setups
// (plain HTTP, older WebViews); the hidden-textarea execCommand path covers
// those. Callers surface the manual-copy fallback when both fail.
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      return copied
    } catch {
      return false
    }
  }
}
