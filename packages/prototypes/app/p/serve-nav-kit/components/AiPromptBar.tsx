'use client'

import { Clock } from 'lucide-react'
import { AiIcon, IconButton, MicIcon } from '@goodparty_org/styleguide'

type AiPromptBarProps = {
  placeholder?: string
}

// Conic-gradient border used by the real ChatPill (tokens live in styleguide's
// tailwind-theme.css, so they resolve here too).
const GRADIENT_STYLE = {
  background:
    'conic-gradient(from var(--gradient-angle), var(--ai-gradient-from), var(--ai-gradient-to), var(--ai-gradient-from))',
}

// Faithful rebuild of gp-webapp's AiChatBar + ChatPill using styleguide-exported
// primitives (IconButton, AiIcon, MicIcon) and DS tokens. The real AiChat pattern
// is not exported from @goodparty_org/styleguide (its source lives in gp-webapp),
// so prototypes can't import it directly — see NEW_COMPONENTS.md.
export const AiPromptBar = ({
  placeholder = 'Hi Renee, how can I help?',
}: AiPromptBarProps) => (
  <div className="sticky bottom-3 z-10 mx-auto w-full max-w-[608px] px-1">
    <div
      className="animate-spin-gradient motion-reduce:animate-none relative rounded-full p-[1.5px] shadow-lg"
      style={GRADIENT_STYLE}
    >
      <div className="bg-card flex min-h-12 w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-1.5">
        <IconButton variant="ghost" size="medium" aria-label="Chat history">
          <Clock className="size-5" aria-hidden />
        </IconButton>
        <button
          type="button"
          className="text-muted-foreground focus-visible:ring-primary-focus flex-1 truncate rounded-full text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {placeholder}
        </button>
        <IconButton
          variant="ghost"
          size="medium"
          aria-label="Dictate a message"
        >
          <MicIcon className="size-5" aria-hidden />
        </IconButton>
        <IconButton
          size="medium"
          aria-label="Ask AI"
          className="bg-primary text-primary-foreground"
        >
          <AiIcon className="size-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  </div>
)
