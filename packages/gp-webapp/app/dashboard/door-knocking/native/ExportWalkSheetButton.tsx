import { Button, DownloadIcon } from '@styleguide'
import { useSnackbar } from 'helpers/useSnackbar'

// The walk sheet, as the design's full-width outline button. It appears in two
// places that have nothing else in common — the walk's own sheet, above the
// stop list, and the outreach history drawer on a door-knocking row — so it is
// one component rather than two copies of a label, an icon, a path and a
// toast that would drift the moment one of them was touched.
//
// The details drawer's compact `PDF` button is deliberately NOT this: the
// design keeps it, in the row of controls beside Start knocking, where the
// word is the affordance and the full sentence would not fit.
//
// A plain anchor to the print route handler, so the paper a canvasser walking
// out of signal takes costs this bundle nothing. The snackbar fires on the
// click rather than on the download completing, because a route handler
// opening in a new tab reports nothing back — it is an acknowledgement of the
// press, which is what the design's toast is too.
//
// Directive-free: it holds no state and both call sites are already client
// components, the `turfLifecycle.ts` rule.
export const ExportWalkSheetButton = ({ turfId }: { turfId: number }) => {
  const { successSnackbar } = useSnackbar()
  return (
    <Button asChild variant="outline" className="w-full">
      <a
        href={`/dashboard/door-knocking/print/${turfId}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => successSnackbar('Walk sheet downloaded')}
      >
        <DownloadIcon size={16} aria-hidden="true" />
        Export this list to PDF
      </a>
    </Button>
  )
}
