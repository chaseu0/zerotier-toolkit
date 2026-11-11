import { Peer, PeerConnectionState, PeerHistory, PeerHistorySample } from '../../typings/zerotier.ts'

export const PEER_HISTORY_INTERVAL_MS = 60_000
export const PEER_HISTORY_RETENTION_MS = 6 * 60 * 60 * 1000
export const PEER_HISTORY_MAX_SAMPLES = PEER_HISTORY_RETENTION_MS / PEER_HISTORY_INTERVAL_MS

const getConnection = (peer: Peer, activePaths: number): PeerConnectionState => {
  if (peer.tunneled) {
    return 'tunneled'
  }
  if (activePaths > 0) {
    return 'direct'
  }
  return peer.role === 'PLANET' || peer.role === 'MOON' ? 'idle' : 'relayed'
}

export const createPeerHistorySample = (peer: Peer, timestamp: number): PeerHistorySample => {
  const activePaths = (peer.paths ?? []).filter((path) => path.active && !path.expired)
  const preferredPath = activePaths.find((path) => path.preferred) ?? activePaths[0]
  const latency = typeof peer.latency === 'number' && peer.latency >= 0 ? peer.latency : undefined
  const lastReceive = (peer.paths ?? []).reduce<number | undefined>((latest, path) => {
    if (typeof path.lastReceive !== 'number' || path.lastReceive <= 0) {
      return latest
    }
    return latest === undefined || path.lastReceive > latest ? path.lastReceive : latest
  }, undefined)

  return {
    timestamp,
    connection: getConnection(peer, activePaths.length),
    activePaths: activePaths.length,
    ...(latency === undefined ? {} : { latency }),
    ...(lastReceive === undefined ? {} : { lastReceive }),
    ...(preferredPath?.address ? { preferredPath: preferredPath.address } : {}),
  }
}

export const appendPeerHistory = (history: PeerHistory, peers: Peer[], timestamp: number): PeerHistory => {
  const cutoff = timestamp - PEER_HISTORY_RETENTION_MS
  const next: PeerHistory = {}
  let changed = false

  for (const [address, samples] of Object.entries(history)) {
    const retained = samples.filter((sample) => sample.timestamp >= cutoff).slice(-PEER_HISTORY_MAX_SAMPLES)
    if (retained.length !== samples.length) {
      changed = true
    }
    if (retained.length) {
      next[address] = retained
    } else if (samples.length) {
      changed = true
    }
  }

  for (const peer of peers) {
    const address = peer.address
    if (!address) {
      continue
    }
    const samples = next[address] ?? []
    const lastSample = samples[samples.length - 1]
    if (lastSample && timestamp - lastSample.timestamp < PEER_HISTORY_INTERVAL_MS) {
      continue
    }
    next[address] = [...samples, createPeerHistorySample(peer, timestamp)].slice(-PEER_HISTORY_MAX_SAMPLES)
    changed = true
  }

  return changed ? next : history
}
