import { createContext, useContext, useState, type ReactNode } from 'react'
import { noop } from '@shared/utils/noop'
import ChannelPickerSheet from './ChannelPickerSheet'
import type { ChannelPickerTarget } from './channelPickerHref.util'

const Context = createContext<(target: ChannelPickerTarget) => void>(noop)

// Every Send outreach on the voter data page opens the same "Choose a
// channel" sheet — list cards, the universe row, both detail sheets, and the
// recommended cards — so the one instance lives here, above all of them,
// the way ContactProModalProvider serves the Pro modal.
export const useOpenChannelPicker = (): ((
  target: ChannelPickerTarget,
) => void) => useContext(Context)

export const ChannelPickerProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [target, setTarget] = useState<ChannelPickerTarget | null>(null)
  return (
    <Context.Provider value={setTarget}>
      {children}
      <ChannelPickerSheet target={target} onClose={() => setTarget(null)} />
    </Context.Provider>
  )
}
