import publicPeerRoster from '../../data/public-peer-roster.json'
import { Peer } from '../../typings/zerotier.ts'

export type PeerRosterEntry = {
  address: string
  displayName: string
  managedAddresses: string[]
  platform?: string
}

export type PeerDisplayRecord = Peer & {
  locallyObserved: boolean
  rosterEntry?: PeerRosterEntry
}

export const peerRoster = publicPeerRoster as PeerRosterEntry[]

export const mergePeerRoster = (peers: Peer[]): PeerDisplayRecord[] => {
  const records = new Map<string, PeerDisplayRecord>()

  for (const peer of peers) {
    if (!peer.address) continue
    records.set(peer.address, { ...peer, locallyObserved: true })
  }

  for (const rosterEntry of peerRoster) {
    const current = records.get(rosterEntry.address)
    records.set(rosterEntry.address, {
      ...(current ?? { address: rosterEntry.address, role: 'LEAF', paths: [] }),
      locallyObserved: current !== undefined,
      rosterEntry,
      version: current?.version,
      paths: current?.paths ?? [],
      latency: current?.latency,
      tunneled: current?.tunneled,
    })
  }

  return [...records.values()]
}
