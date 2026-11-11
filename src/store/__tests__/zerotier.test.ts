import { mockPeers } from '../../__mocks__/zerotier.ts'
import { ZerotierConfig } from '../../typings/config.ts'
import { PEER_HISTORY_INTERVAL_MS } from '../../utils/helpers/peerHistory.ts'
import { mockConfigIPC } from '../../utils/testUtils/tauriMocks.ts'
import { useZeroTierStore } from '../zerotier.ts'

const { getState, setState } = useZeroTierStore

beforeEach(() => {
  mockConfigIPC()
})

describe('zerotier store', () => {
  it('should load the networks joined by this node', async () => {
    await getState().getNetworks()

    expect(getState().networks.map(({ id }) => id)).toEqual(['882d314dd3dbd4dd', '8056c2e21c000001'])
  })

  it('should keep the networks gone from the service as disconnected', async () => {
    setState({ config: { [ZerotierConfig.NETWORKS]: [{ id: 'aaaaaaaaaaaaaaaa', name: 'Old network' }] } })

    await getState().getNetworks()

    expect(getState().networks.find(({ id }) => id === 'aaaaaaaaaaaaaaaa')?.status).toBe('DISCONNECTED')
    expect(getState().config[ZerotierConfig.NETWORKS]?.length).toBe(3)
  })

  it('should load the peers of this node', async () => {
    await getState().getPeers()

    expect(getState().peers.length).toBe(mockPeers.length)
  })

  it('should disconnect a network and delete it from the history', async () => {
    await getState().getNetworks()
    const networkId = '882d314dd3dbd4dd'

    await getState().disconnectNetwork(networkId)
    expect(getState().networks.find(({ id }) => id === networkId)?.status).toBe('DISCONNECTED')

    getState().deleteNetwork(networkId)
    expect(getState().networks.find(({ id }) => id === networkId)).toBeUndefined()
  })

  it('should merge the configuration given by the user', () => {
    getState().setConfig({ [ZerotierConfig.TOKEN]: 'local-token' })

    expect(getState().config[ZerotierConfig.TOKEN]).toBe('local-token')
  })

  it('should persist peer history samples and throttle sampling to once per minute', () => {
    setState({ config: {} })
    const peer = mockPeers[0]
    const sampledAt = 100_000

    getState().recordPeerSamples([peer], sampledAt)
    getState().recordPeerSamples([peer], sampledAt + PEER_HISTORY_INTERVAL_MS - 1)
    expect(getState().config[ZerotierConfig.PEER_HISTORY]?.[peer.address!]).toHaveLength(1)

    getState().recordPeerSamples([peer], sampledAt + PEER_HISTORY_INTERVAL_MS)
    expect(getState().config[ZerotierConfig.PEER_HISTORY]?.[peer.address!]).toHaveLength(2)
  })
})
