import { fireEvent, waitFor } from '@testing-library/react'

import { mockPeers } from '../../../../__mocks__/zerotier.ts'
import { useZeroTierStore } from '../../../../store/zerotier.ts'
import { ZerotierConfig } from '../../../../typings/config.ts'
import { render } from '../../../../utils/testUtils/setupTest.tsx'
import ZerotierPeers from '../ZerotierPeers.tsx'

const initialPeers = structuredClone(mockPeers)

describe('ZerotierPeers', () => {
  afterEach(() => {
    mockPeers.splice(0, mockPeers.length, ...structuredClone(initialPeers))
  })

  it('should render the connected peers', async () => {
    const { getAllByRole, getAllByText, getByText, queryByText } = render(<ZerotierPeers />)

    await waitFor(() => expect(getByText('25a4a6b1ba')).toBeTruthy())
    expect(getByText('PLANET')).toBeTruthy()
    expect(getByText('MOON')).toBeTruthy()
    expect(getAllByText('LEAF').length).toBeGreaterThanOrEqual(2)
    expect(getByText('103.195.103.66/9993')).toBeTruthy()
    expect(getByText('120.239.74.49/52769')).toBeTruthy()
    expect(getAllByText('No path').length).toBeGreaterThan(1)
    expect(queryByText('-1.-1.-1')).toBeNull()

    const addresses = getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent)
    expect(addresses).toContain('a3c1f8a2c9')
    expect(addresses).toContain('b7d2e5f1c3')
    expect(addresses).toContain('62f865ae71')
    expect(addresses).toContain('25a4a6b1ba')
    expect(addresses).toContain('f46bff6b1c')
    expect(addresses).toHaveLength(13)
    expect(getByText('XIPKVM')).toBeTruthy()
    expect(
      getAllByText('Not returned by local /peer API; online and authorization state cannot be determined here.').length,
    ).toBe(9)
  })

  it('should keep the peers matching the keyword only', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<ZerotierPeers />)
    await waitFor(() => expect(getByText('a3c1f8a2c9')).toBeTruthy())

    fireEvent.change(getByPlaceholderText('Search peers...'), { target: { value: '103.195' } })

    expect(getByText('25a4a6b1ba')).toBeTruthy()
    expect(queryByText('a3c1f8a2c9')).toBeNull()
    expect(getByText('1/13')).toBeTruthy()
  })

  it('lets me attach a managed IP, display name and local tags to a peer', async () => {
    const { getAllByText, getByLabelText, getByRole, getByText } = render(<ZerotierPeers />)
    await waitFor(() => expect(getByText('a3c1f8a2c9')).toBeTruthy())

    fireEvent.click(getByText('a3c1f8a2c9').closest('tr')!)
    fireEvent.change(getByLabelText('Display name'), { target: { value: 'Office Mac' } })
    fireEvent.change(getByLabelText('Managed IP addresses'), { target: { value: '10.6.1.8' } })
    fireEvent.change(getByLabelText('Tags'), { target: { value: 'office, build' } })
    fireEvent.click(getByRole('button', { name: 'Save local details' }))

    await waitFor(() => {
      expect(getAllByText('10.6.1.8').length).toBeGreaterThan(1)
      expect(getByText('Office Mac')).toBeTruthy()
      expect(getByText('office')).toBeTruthy()
      expect(getByText('build')).toBeTruthy()
    })
    expect(useZeroTierStore.getState().config[ZerotierConfig.PEER_METADATA]?.a3c1f8a2c9).toEqual({
      displayName: 'Office Mac',
      managedAddresses: ['10.6.1.8'],
      tags: ['office', 'build'],
    })
  })
})
