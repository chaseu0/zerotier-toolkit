import { Peer } from '../../../typings/zerotier.ts'
import {
  appendPeerHistory,
  createPeerHistorySample,
  PEER_HISTORY_INTERVAL_MS,
  PEER_HISTORY_RETENTION_MS,
} from '../peerHistory.ts'

const peer: Peer = {
  address: '0123456789',
  role: 'LEAF',
  latency: 42,
  paths: [
    {
      address: '192.0.2.10/9993',
      active: true,
      preferred: true,
      lastReceive: 10_000,
    },
  ],
}

describe('peerHistory', () => {
  it('captures latency, connection state, activity and preferred path', () => {
    expect(createPeerHistorySample(peer, 20_000)).toEqual({
      timestamp: 20_000,
      connection: 'direct',
      activePaths: 1,
      latency: 42,
      lastReceive: 10_000,
      preferredPath: '192.0.2.10/9993',
    })
  })

  it('samples at most once per minute and keeps peers separate', () => {
    const first = appendPeerHistory({}, [peer], 100_000)
    const sameInterval = appendPeerHistory(first, [peer], 100_000 + PEER_HISTORY_INTERVAL_MS - 1)
    const nextInterval = appendPeerHistory(sameInterval, [peer], 100_000 + PEER_HISTORY_INTERVAL_MS)

    expect(sameInterval).toBe(first)
    expect(nextInterval[peer.address!]).toHaveLength(2)
  })

  it('removes samples older than the retention window', () => {
    const oldTimestamp = 100_000
    const history = { [peer.address!]: [createPeerHistorySample(peer, oldTimestamp)] }

    expect(appendPeerHistory(history, [], oldTimestamp + PEER_HISTORY_RETENTION_MS + 1)).toEqual({})
  })
})
