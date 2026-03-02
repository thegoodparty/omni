'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Link,
  Text,
} from '@radix-ui/themes'
import type { EcanvasserSummary } from '@goodparty_org/sdk'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useToast } from '@/components/Toast'
import { listEcanvassers, syncAllEcanvassers } from '../actions'
import { EcanvasserTable } from './EcanvasserTable'
import { AddEcanvasserDialog } from './AddEcanvasserDialog'

export function EcanvasserPage() {
  const [ecanvassers, setEcanvassers] = useState<EcanvasserSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const { showToast } = useToast()

  const loadEcanvassers = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await listEcanvassers()
      setEcanvassers(data)
    } catch {
      showToast('Failed to load ecanvassers')
    } finally {
      setIsLoading(false)
    }
  }, [showToast])

  async function handleSyncAll() {
    setIsSyncing(true)
    try {
      const data = await syncAllEcanvassers()
      setEcanvassers(data)
      showToast('Sync complete')
    } catch {
      showToast('Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    loadEcanvassers()
  }, [loadEcanvassers])

  return (
    <Container size="4">
      <Flex justify="between" align="center" mb="4">
        <Box>
          <Heading size="6">Ecanvasser</Heading>
          <Text size="2" color="gray">
            Manage ecanvasser API key integrations.{' '}
            <Link
              href="https://support.ecanvasser.com/en/articles/7019426-access-your-api-key"
              target="_blank"
              rel="noreferrer"
            >
              How to get an API key
            </Link>
          </Text>
        </Box>
        <Flex gap="3">
          <Button
            variant="soft"
            onClick={handleSyncAll}
            disabled={isSyncing || isLoading}
            loading={isSyncing}
          >
            Sync All
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={isLoading}>
            Add API Key
          </Button>
        </Flex>
      </Flex>

      {isLoading ? (
        <LoadingSpinner>Loading ecanvassers...</LoadingSpinner>
      ) : (
        <EcanvasserTable ecanvassers={ecanvassers} onUpdate={loadEcanvassers} />
      )}

      <AddEcanvasserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={loadEcanvassers}
      />
    </Container>
  )
}
