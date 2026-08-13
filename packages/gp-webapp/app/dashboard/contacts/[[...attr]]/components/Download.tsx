'use client'
import { DownloadIcon, IconButton, LockIcon } from '@styleguide'
import { useContactsTable } from '../../crm/ContactsTableProvider'
import { type SegmentResponse } from '../../crm/shared/contacts-types'
import {
  isCustomSegment,
  findCustomSegment,
  filterOnlyTrueValues,
} from '../../crm/shared/segments.util'
import { useShowContactProModal } from '../../crm/ContactProModal'
import { useContactsDownload } from '../../crm/shared/useContactsDownload'

export default function Download() {
  const showProUpgradeModal = useShowContactProModal()
  const { customSegments, currentSegment, canUseProFeatures, isWinContext } =
    useContactsTable()
  const { download, isPreparing } = useContactsDownload({
    canUseProFeatures,
    onProGated: () => showProUpgradeModal(true),
  })

  const handleDownload = (): void => {
    download(currentSegment, generateProperties())
  }

  const generateProperties = (): Record<
    string,
    string | number | boolean | null | undefined
  > => {
    const context = isWinContext ? 'win' : 'serve'
    if (!currentSegment || !isCustomSegment(customSegments, currentSegment)) {
      return {
        filters: null,
        isCustomSegment: false,
        isDefaultSegment: true,
        segment: currentSegment,
        context,
      }
    }
    const filterValues = filters()
    return {
      filters: filterValues ? JSON.stringify(filterValues) : null,
      isCustomSegment: true,
      isDefaultSegment: false,
      context,
    }
  }

  const filters = (): string[] | null => {
    if (!currentSegment || !isCustomSegment(customSegments, currentSegment)) {
      return null
    }
    const allFilters = findCustomSegment(customSegments, currentSegment) as
      | SegmentResponse
      | undefined
    if (!allFilters) {
      return null
    }
    const filterRecord: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(allFilters)) {
      if (
        key !== 'id' &&
        key !== 'value' &&
        key !== 'name' &&
        typeof value === 'boolean'
      ) {
        filterRecord[key] = value
      }
    }
    return filterOnlyTrueValues(filterRecord)
  }

  return (
    <>
      <IconButton
        data-testid="contacts-download-button"
        variant="outline"
        onClick={handleDownload}
        loading={isPreparing}
        className="hidden md:flex"
      >
        {!canUseProFeatures ? <LockIcon /> : <DownloadIcon />}
      </IconButton>
    </>
  )
}
