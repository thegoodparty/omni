// Stands in for @styleguide/hooks/use-mobile: mobile means the frame is under 1024px,
// not the window. Same breakpoint as the hook (lg).
import { useFrame } from './frame'

export const useIsMobile = () => {
  const { width } = useFrame()
  return width === 0 || width < 1024
}
