import { mockPeers } from '../../../__mocks__/zerotier.ts'
import { mergePeerRoster } from '../peerRoster.ts'

describe('peerRoster', () => {
  it('keeps public roster devices even when the local /peer response omits them', () => {
    const peers = mergePeerRoster(mockPeers)
    const xipkvm = peers.find(({ address }) => address === 'f46bff6b1c')

    expect(peers).toHaveLength(mockPeers.length + 9)
    expect(xipkvm).toMatchObject({
      locallyObserved: false,
      rosterEntry: { displayName: 'XIPKVM', managedAddresses: ['10.6.1.10'], platform: 'Linux' },
      paths: [],
    })
  })

  it('uses the live local peer data when an entry exists in both sources', () => {
    const peers = mergePeerRoster(mockPeers)
    const leaf = peers.find(({ address }) => address === 'a3c1f8a2c9')

    expect(leaf?.locallyObserved).toBe(true)
    expect(leaf?.tunneled).toBe(true)
    expect(leaf?.rosterEntry).toBeUndefined()
  })
})
