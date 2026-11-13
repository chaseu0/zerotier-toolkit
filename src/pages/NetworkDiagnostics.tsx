import { Button, Chip, Spinner } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { useZeroTierStore } from '../store/zerotier.ts'
import { InvokeEvent } from '../typings/enum.ts'
import { Peer } from '../typings/zerotier.ts'
import { mergeRouteHops, parseRouteHops, RouteHop } from '../utils/helpers/routeTrace.ts'

const PEER_REFRESH_MS = 10_000
const TRACE_CACHE_TTL_MS = 60 * 60 * 1000
const TRACE_REFRESH_MS = TRACE_CACHE_TTL_MS
const MAX_CONCURRENT_TRACES = 3
const TRACE_CACHE_KEY = 'zerotier-toolkit.route-traces.v2'
const LEGACY_TRACE_CACHE_KEY = 'zerotier-toolkit.route-traces.v1'

type RouteResult = { target: string; output: string; success: boolean; exitCode?: number }
type PeerTrace = { target: string; hops: RouteHop[]; checkedAt: number; error?: string }
type PeerTraceCache = Record<string, PeerTrace>

const loadTraceCache = (): PeerTraceCache => {
  try {
    const value = localStorage.getItem(TRACE_CACHE_KEY) ?? localStorage.getItem(LEGACY_TRACE_CACHE_KEY)
    if (!value) return {}

    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return []
        const trace = value as Partial<PeerTrace>
        if (typeof trace.target !== 'string' || !Array.isArray(trace.hops) || typeof trace.checkedAt !== 'number')
          return []
        const hops = trace.hops.flatMap((value) => {
          if (!value || typeof value !== 'object') return []
          const hop = value as Partial<RouteHop>
          if (typeof hop.index !== 'number' || !Array.isArray(hop.rtts)) return []
          const ip = typeof hop.ip === 'string' ? hop.ip : undefined
          return [
            {
              index: hop.index,
              ip,
              ips: Array.isArray(hop.ips)
                ? hop.ips.filter((item): item is string => typeof item === 'string')
                : ip
                  ? [ip]
                  : [],
              rtts: hop.rtts.filter((item): item is number => typeof item === 'number'),
              probes: typeof hop.probes === 'number' ? hop.probes : 3,
              lossHistory: Array.isArray(hop.lossHistory)
                ? hop.lossHistory.filter((item): item is number => typeof item === 'number')
                : [],
              lossPercent: typeof hop.lossPercent === 'number' ? hop.lossPercent : 0,
            },
          ]
        })
        return [
          [key, { target: trace.target, hops, checkedAt: trace.checkedAt, error: trace.error } satisfies PeerTrace],
        ]
      }),
    )
  } catch {
    return {}
  }
}

const activePath = (peer: Peer) => {
  const activePaths = peer.paths?.filter((path) => path.active && !path.expired && path.address) ?? []
  return activePaths.find((path) => path.preferred) ?? activePaths[0]
}
const pathIp = (address?: string) => address?.split('/')[0]

function NetworkDiagnostics() {
  const { t } = useTranslation()
  const { peers, getPeers } = useZeroTierStore()
  const peersRef = useRef(peers)
  const runningRef = useRef(false)
  const [isTracing, setIsTracing] = useState(false)
  const [traceByPeer, setTraceByPeer] = useState<PeerTraceCache>(loadTraceCache)
  const [loadError, setLoadError] = useState(false)
  const traceByPeerRef = useRef(traceByPeer)

  useEffect(() => {
    peersRef.current = peers
  }, [peers])

  useEffect(() => {
    traceByPeerRef.current = traceByPeer
  }, [traceByPeer])

  const refreshPeers = useCallback(async () => {
    try {
      await getPeers()
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [getPeers])

  const tracePeers = useCallback(async (force = false) => {
    if (runningRef.current) return
    const targets = peersRef.current
      .filter((peer) => peer.role === 'LEAF' || peer.role === 'MOON')
      .map((peer) => ({ peer, target: pathIp(activePath(peer)?.address) }))
      .filter((item): item is { peer: Peer; target: string } => {
        if (!item.target) return false
        const cached = traceByPeerRef.current[item.peer.address ?? item.target]
        return force || !cached || cached.target !== item.target || Date.now() - cached.checkedAt >= TRACE_CACHE_TTL_MS
      })
    if (!targets.length) return

    runningRef.current = true
    setIsTracing(true)
    try {
      const nextResults: Record<string, PeerTrace> = {}
      let cursor = 0
      const worker = async () => {
        while (cursor < targets.length) {
          const item = targets[cursor++]
          try {
            const result = await invoke<RouteResult>(InvokeEvent.TRACE_ROUTE, { target: item.target })
            nextResults[item.peer.address ?? item.target] = {
              target: item.target,
              hops: parseRouteHops(result.output),
              checkedAt: Date.now(),
              error: result.success ? undefined : result.output || 'No route probes answered',
            }
          } catch (cause) {
            nextResults[item.peer.address ?? item.target] = {
              target: item.target,
              hops: [],
              checkedAt: Date.now(),
              error: cause instanceof Error ? cause.message : String(cause),
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_TRACES, targets.length) }, worker))
      setTraceByPeer((current) => {
        const merged = { ...current }
        for (const [key, trace] of Object.entries(nextResults)) {
          const previous = current[key]
          merged[key] = {
            ...trace,
            hops:
              previous?.target === trace.target && trace.hops.length
                ? mergeRouteHops(previous.hops, trace.hops)
                : trace.hops,
          }
        }
        return merged
      })
    } finally {
      runningRef.current = false
      setIsTracing(false)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(TRACE_CACHE_KEY, JSON.stringify(traceByPeer))
    } catch {
      // Keep diagnostics usable when persistent storage is unavailable.
    }
  }, [traceByPeer])

  useEffect(() => {
    void refreshPeers()
    const timer = window.setInterval(() => void refreshPeers(), PEER_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refreshPeers])

  useEffect(() => {
    const timer = window.setInterval(() => void tracePeers(false), TRACE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [tracePeers])

  useEffect(() => {
    if (peers.length && !runningRef.current) void tracePeers(false)
  }, [peers, tracePeers])

  const monitoredPeers = peers
    .filter((peer) => peer.role === 'LEAF' || peer.role === 'MOON')
    .sort((a, b) => (a.address ?? '').localeCompare(b.address ?? ''))
  const lastUpdatedAt = Math.max(0, ...Object.values(traceByPeer).map(({ checkedAt }) => checkedAt))
  const updatedTime = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : undefined

  return (
    <div className="h-full overflow-auto pb-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-default-200 pb-3 text-small">
        <Chip size="sm" variant="flat" color={loadError ? 'warning' : 'success'}>
          <Trans>{loadError ? 'Peer data unavailable' : 'Automatic monitoring'}</Trans>
        </Chip>
        <span className="text-default-500">
          <Trans>Route results are cached for one hour</Trans>
        </span>
        {isTracing && <Spinner size="sm" aria-label={t('Tracing peer routes')} />}
        {updatedTime && (
          <span className="text-tiny text-default-500">{t('Last route scan {{time}}', { time: updatedTime })}</span>
        )}
        <Button
          className="ml-auto"
          size="sm"
          color="primary"
          variant="flat"
          isLoading={isTracing}
          onPress={() => void tracePeers(true)}
        >
          <Trans>Probe now</Trans>
        </Button>
      </div>
      <p className="border-b border-default-200 py-3 text-tiny leading-5 text-default-500">
        <Trans>Peer route scope notice</Trans>
      </p>
      {monitoredPeers.length === 0 ? (
        <div className="py-8 text-center text-small text-default-500">
          <Trans>{loadError ? 'Failed to load peers' : 'No peer nodes available'}</Trans>
        </div>
      ) : (
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[minmax(120px,1fr)_100px_100px_minmax(220px,2fr)] gap-3 border-b border-default-300 py-2 text-tiny font-semibold text-default-500">
            <span>
              <Trans>Peer node</Trans>
            </span>
            <span>
              <Trans>ZT latency</Trans>
            </span>
            <span>
              <Trans>Underlay path</Trans>
            </span>
            <span>
              <Trans>Route hops (IP / RTT / loss)</Trans>
            </span>
          </div>
          {monitoredPeers.map((peer) => {
            const key = peer.address ?? ''
            const path = activePath(peer)
            const target = pathIp(path?.address)
            const trace = traceByPeer[key]
            const latency = typeof peer.latency === 'number' && peer.latency >= 0 ? peer.latency + ' ms' : '-'
            return (
              <div
                key={key}
                className="grid grid-cols-[minmax(120px,1fr)_100px_100px_minmax(220px,2fr)] gap-3 border-b border-default-100 py-3 text-small"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono">{key || '-'}</div>
                  <div className="text-tiny text-default-500">{peer.role}</div>
                </div>
                <div className="font-mono">{latency}</div>
                <div className="min-w-0">
                  {target ? (
                    <span className="block truncate font-mono" title={path?.address}>
                      {target}
                    </span>
                  ) : (
                    <span className="text-default-400">
                      <Trans>No active path</Trans>
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  {trace?.error ? (
                    <span className="text-danger" title={trace.error}>
                      <Trans>Route probe failed</Trans>
                    </span>
                  ) : trace?.hops.length ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-tiny">
                      {trace.hops.map((hop) => (
                        <span key={key + '-' + hop.index} className={hop.ip ? 'text-default-700' : 'text-warning'}>
                          {hop.index}. {(hop.ips ?? (hop.ip ? [hop.ip] : [])).join(', ') || hop.ip || '*'}{' '}
                          {hop.rtts.map((rtt) => rtt + ' ms').join(' / ')} {hop.lossPercent}%
                        </span>
                      ))}
                    </div>
                  ) : target ? (
                    <span className="text-default-400">
                      <Trans>{isTracing ? 'Tracing...' : 'Waiting for first route scan'}</Trans>
                    </span>
                  ) : (
                    <span className="text-default-400">-</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default NetworkDiagnostics
