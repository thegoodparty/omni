import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ConfirmedConstituentFeedbackIssue,
  ConstituentFeedbackIssue,
} from '@goodparty_org/contracts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EllipsisVerticalIcon,
  IconButton,
  PencilIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { IssueCaptureConfirmStep } from 'app/dashboard/door-knocking/native/IssueCaptureConfirmCard'
import { PanelDrawer } from 'app/dashboard/door-knocking/native/PanelDrawer'
import { whatWeHeardCopy } from '../../copy'
import { REPORT_QUERY_KEY_PREFIX } from '../queries'

// Edit, and only edit: a note is the record of a conversation, so it can be
// corrected but never removed from here. What can be corrected is what was
// taken from it, its issues, through the same confirm the canvasser saw; the
// note's own words need the record path, which the report does not carry.
const EditMemoMenu = ({
  memo,
  isServe,
}: {
  memo: { id: string; issues: ConstituentFeedbackIssue[] }
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)

  const save = useMutation({
    mutationFn: (issues: ConfirmedConstituentFeedbackIssue[]) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: memo.id,
        issues,
      }),
    // The report's counts and a theme's members are both read live, so both
    // re-read; the theme a note sits in only moves on the next summary.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEY_PREFIX }),
        queryClient.invalidateQueries({ queryKey: ['issue-capture', 'theme'] }),
      ])
      setEditing(false)
    },
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            variant="ghost"
            size="small"
            aria-label={copy.noteActions}
          >
            <EllipsisVerticalIcon size={18} />
          </IconButton>
        </DropdownMenuTrigger>
        {/* Focus is not handed back to the trigger on close: the edit opens
            as the menu closes, and a modal drawer dismisses on focus outside
            it, which would close it as it opened. */}
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <PencilIcon size={16} />
            {copy.editNote}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* A sibling of the menu, not inside it: the menu unmounts its content
          when an item is chosen, and would take the drawer with it. */}
      {editing && (
        <PanelDrawer
          sheetClassName="sm:max-w-md"
          drawerClassName="h-[92dvh] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
          hasDescription
          onDismiss={() => {
            save.reset()
            setEditing(false)
          }}
          busy={save.isPending}
        >
          <IssueCaptureConfirmStep
            proposed={{ issues: memo.issues }}
            saving={save.isPending}
            isServe={isServe}
            onConfirm={(issues) => save.mutate(issues)}
            error={save.isError ? copy.confirmFailed : undefined}
          />
        </PanelDrawer>
      )}
    </>
  )
}

export default EditMemoMenu
