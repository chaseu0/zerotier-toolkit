import { Chip, Input } from '@heroui/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { SearchIcon } from '../../../components/base/Icon.tsx'
import RefreshButton from '../../../components/base/RefreshButton.tsx'
import { useZeroTierStore } from '../../../store/zerotier.ts'
import { ZerotierConfig } from '../../../typings/config.ts'
import { PeerMetadata } from '../../../typings/zerotier.ts'
import { mergePeerRoster } from '../../../utils/helpers/peerRoster.ts'
import useRequest from '../../../utils/hooks/useRequest.ts'
import { connectionChip, peerConnection } from './peerHelpers.ts'
import PeersTable from './PeersTable.tsx'

const AUTO_REFRESH_INTERVAL_MS = 5000

function ZerotierPeers() {
  const { t } = useTranslation()
  const { request } = useRequest()
  const { peers, getPeers, config, setConfig } = useZeroTierStore()
  const peerMetadata = config[ZerotierConfig.PEER_METADATA] ?? {}
  const displayPeers = mergePeerRoster(peers)

  const [isLoading, setIsLoading] = useState(!peers.length)
  const [isError, setIsError] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>()
  const [clock, setClock] = useState(Date.now())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const loadingRef = useRef(false)

  const loadPeers = useCallback(async (showSpinner = false) => {
    if (loadingRef.current) {
      return
    }
    loadingRef.current = true
    if (showSpinner) {
      setIsLoading(true)
    }
    try {
      await request(getPeers())
      setIsError(false)
      setIsStale(false)
      setLastUpdatedAt(Date.now())
    } catch {
      setIsStale(true)
      if (!useZeroTierStore.getState().peers.length) {
        setIsError(true)
      }
    } finally {
      loadingRef.current = false
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    loadPeers(!useZeroTierStore.getState().peers.length)
    const interval = window.setInterval(() => loadPeers(), AUTO_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [loadPeers])

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await loadPeers()
    setTimeout(() => setIsRefreshing(false), 300)
  }, [loadPeers])

  const [filterValue, setFilterValue] = useState('')
  const filteredPeers = displayPeers.filter((peer) => {
    const keyword = filterValue.toLowerCase()
    return (
      peer.address?.includes(keyword) ||
      peer.role?.toLowerCase().includes(keyword) ||
      peer.version?.includes(keyword) ||
      peer.rosterEntry?.displayName.toLowerCase().includes(keyword) ||
      peer.rosterEntry?.platform?.toLowerCase().includes(keyword) ||
      peer.rosterEntry?.managedAddresses.some((address) => address.toLowerCase().includes(keyword)) ||
      peer.paths?.some((path) => path.address?.toLowerCase().includes(keyword)) ||
      peerMetadata[peer.address ?? '']?.displayName?.toLowerCase().includes(keyword) ||
      peerMetadata[peer.address ?? '']?.managedAddresses?.some((address) => address.toLowerCase().includes(keyword)) ||
      peerMetadata[peer.address ?? '']?.tags?.some((tag) => tag.toLowerCase().includes(keyword)) ||
      t(connectionChip[peerConnection(peer)].label).toLowerCase().includes(keyword)
    )
  })

  const savePeerMetadata = (address: string, metadata: PeerMetadata) => {
    const nextMetadata = { ...peerMetadata }
    if (!metadata.displayName && !metadata.managedAddresses?.length && !metadata.tags?.length) {
      delete nextMetadata[address]
    } else {
      nextMetadata[address] = metadata
    }
    setConfig({ [ZerotierConfig.PEER_METADATA]: nextMetadata })
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="w-full flex items-center gap-2">
        <span className="flex-shrink-0 text-default-700">
          <Trans>Known peers</Trans>
        </span>
        <span className="hidden text-tiny text-default-400 xl:inline">
          <Trans>Shared device names and ZeroTier IPs come from the public peer roster file.</Trans>
        </span>
        <Chip
          size="sm"
          variant="flat"
          color={isStale ? 'warning' : 'success'}
          aria-label={t('Auto-refreshing every {{seconds}} seconds', { seconds: AUTO_REFRESH_INTERVAL_MS / 1000 })}
        >
          <Trans>{isStale ? 'Stale' : 'Live'}</Trans>
        </Chip>
        {lastUpdatedAt && (
          <span className="flex-shrink-0 text-tiny text-default-500">
            {t('Peer data refreshed {{seconds}} seconds ago', { seconds: Math.floor((clock - lastUpdatedAt) / 1000) })}
          </span>
        )}
        <Chip size="sm" variant="flat" className="flex-shrink-0 bg-default-100">
          {filterValue ? `${filteredPeers.length}/${displayPeers.length}` : displayPeers.length}
        </Chip>
        <Input
          isClearable
          className="w-full"
          placeholder={t('Search peers...')}
          startContent={<SearchIcon width="18" height="18" />}
          value={filterValue}
          onClear={() => setFilterValue('')}
          onValueChange={setFilterValue}
        />
        <RefreshButton
          buttonProps={{ className: 'flex-shrink-0 bg-default-100', variant: 'flat' }}
          isLoading={isRefreshing}
          onRefresh={onRefresh}
        />
      </div>
      <PeersTable
        peers={filteredPeers}
        isLoading={isLoading}
        isError={isError}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        history={config[ZerotierConfig.PEER_HISTORY]}
        peerMetadata={peerMetadata}
        onSavePeerMetadata={savePeerMetadata}
      />
    </div>
  )
}

export default ZerotierPeers
