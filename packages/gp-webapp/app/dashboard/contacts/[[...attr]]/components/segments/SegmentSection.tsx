'use client'
import {
  Button,
  IconButton,
  LockIcon,
  PencilIcon,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Trash2Icon,
} from '@styleguide'

import { useState } from 'react'
import DeleteSegment from './DeleteSegment'
import FiltersSheet from './FiltersSheet'
import { useContactsTable } from '../../../crm/ContactsTableProvider'
import { ALL_SEGMENTS, SHEET_MODES } from '../../../crm/shared/constants'
import {
  isDefaultSegment,
  findCustomSegment,
  trimCustomSegmentName,
} from '../../../crm/shared/segments.util'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useShowContactProModal } from '../../../crm/ContactProModal'
import { type SegmentResponse } from '../../../crm/shared/contacts-types'

type SheetMode = (typeof SHEET_MODES)[keyof typeof SHEET_MODES]

interface SheetState {
  open: boolean
  mode: SheetMode
  editSegment: SegmentResponse | null
}

export default function SegmentSection() {
  const {
    segments,
    customSegments,
    currentSegment,
    selectSegment,
    refreshCustomSegments,
    canUseProFeatures,
    isWinContext,
  } = useContactsTable()
  const showProUpgradeModal = useShowContactProModal()
  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    mode: SHEET_MODES.CREATE,
    editSegment: null,
  })

  const isCustom = !isDefaultSegment(segments, currentSegment)

  const handleEdit = () => {
    if (isCustom) {
      const customSegment = findCustomSegment(
        customSegments,
        currentSegment,
      ) as SegmentResponse | null
      setSheetState({
        open: true,
        mode: SHEET_MODES.EDIT,
        editSegment: customSegment || null,
      })
    }
  }

  const handleCreateSegment = () => {
    if (!canUseProFeatures) {
      showProUpgradeModal(true)
      return
    }
    setSheetState({
      open: true,
      mode: SHEET_MODES.CREATE,
      editSegment: null,
    })
  }

  const handleSelect = (selectedSegment: string) => {
    if (!canUseProFeatures) {
      showProUpgradeModal(true)
      return
    }

    const isCustomSegment = !isDefaultSegment(segments, selectedSegment)
    const segmentName = isCustomSegment
      ? (findCustomSegment(customSegments, selectedSegment)?.name ??
        selectedSegment)
      : selectedSegment

    trackEvent(EVENTS.Contacts.SegmentViewed, {
      segment: segmentName,
      type: isCustomSegment ? 'custom' : 'default',
      context: isWinContext ? 'win' : 'serve',
    })

    selectSegment(selectedSegment)
  }

  const handleSheetClose = () => {
    setSheetState({
      open: false,
      mode: SHEET_MODES.CREATE,
      editSegment: null,
    })
  }

  const resetSelect = () => {
    selectSegment(ALL_SEGMENTS)
  }

  const handleAfterSave = async (segmentId: number) => {
    await refreshCustomSegments()
    selectSegment(segmentId.toString())
  }

  const handleAfterDelete = (deletedId: number) => {
    if (currentSegment === deletedId.toString()) {
      selectSegment(ALL_SEGMENTS)
    }
  }

  return (
    <div className="flex items-center flex-col w-full md:w-auto md:flex-row">
      <Select value={currentSegment} onValueChange={handleSelect}>
        <SelectTrigger className="w-full lg:w-[350px] justify-start">
          <label
            htmlFor="segment-select"
            className="text-sm font-normal text-muted-foreground border-r pr-3 border-gray-200"
          >
            Current list
          </label>
          <div className="w-full text-left pl-1">
            <SelectValue placeholder="All Contacts" />
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-[50vh]">
          <SelectGroup>
            <SelectLabel>Default Segments</SelectLabel>
            {segments.map((segment) => (
              <SelectItem key={segment.value} value={segment.value}>
                {segment.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {customSegments && customSegments?.length > 0 && (
            <SelectGroup>
              <SelectLabel>Custom Segments</SelectLabel>
              {customSegments.map((segment) => (
                <div
                  key={segment.id}
                  className="flex items-center justify-between pr-1"
                >
                  <SelectItem value={segment.id.toString()} className="flex-1">
                    {segment.name
                      ? trimCustomSegmentName(segment.name)
                      : 'Unnamed Segment'}
                  </SelectItem>
                  <DeleteSegment
                    segment={segment}
                    afterDeleteCallback={handleAfterDelete}
                    trigger={
                      <IconButton
                        variant="ghost"
                        size="small"
                        aria-label={`Delete ${segment.name ?? 'segment'}`}
                        data-testid={`delete-segment-${segment.id}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2Icon className="size-4 text-muted-foreground" />
                      </IconButton>
                    }
                  />
                </div>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <Button
        variant="default"
        onClick={handleCreateSegment}
        className="font-normal text-sm px-4 w-full mt-4 md:mt-0 mb-4 md:mb-0 md:w-auto md:ml-4"
      >
        {!canUseProFeatures && <LockIcon />}
        Create list
      </Button>

      {isCustom && (
        <>
          <IconButton
            data-testid="edit-list-button"
            variant="outline"
            onClick={handleEdit}
            className="ml-4 font-normal hidden md:flex"
          >
            <div className="w-10 h-10 flex items-center justify-center">
              <PencilIcon />
            </div>
          </IconButton>
          <Button
            variant="outline"
            onClick={handleEdit}
            className="flex md:hidden w-full"
          >
            Edit list
          </Button>
        </>
      )}
      <FiltersSheet
        open={sheetState.open}
        handleClose={handleSheetClose}
        handleOpenChange={(open) =>
          setSheetState((prev) => ({ ...prev, open }))
        }
        mode={sheetState.mode}
        editSegment={sheetState.editSegment}
        resetSelect={resetSelect}
        afterSave={handleAfterSave}
      />
    </div>
  )
}
