import { InvokeArgs } from '@tauri-apps/api/core'
import { mockIPC } from '@tauri-apps/api/mocks'
import { fireEvent, waitFor } from '@testing-library/react'

import { useZeroTierStore } from '../../store/zerotier.ts'
import { render } from '../../utils/testUtils/setupTest.tsx'
import NetworkDiagnostics from '../NetworkDiagnostics.tsx'

describe('NetworkDiagnostics', () => {
  it('automatically traces active peer endpoints and shows parsed hops', async () => {
    localStorage.clear()
    localStorage.setItem(
      'zerotier-toolkit.route-traces.v1',
      JSON.stringify({
        a3c1f8a2c9: {
          target: '120.239.74.49',
          hops: [{ index: 1, ip: '192.168.1.1', rtts: [1], probes: 3, lossHistory: [2], lossPercent: 67 }],
          checkedAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      }),
    )
    useZeroTierStore.setState({ peers: [] })
    const invokeHandler = vi.fn(async (command: string, args?: InvokeArgs) => {
      const target = (args as { target?: string } | undefined)?.target
      return command === 'trace_route'
        ? {
            target,
            output:
              target === '120.239.74.49'
                ? 'traceroute to 120.239.74.49\n 1  192.168.1.1  1.2 ms  1.4 ms  1.1 ms'
                : 'traceroute to 2408:8456::1\n 1  fd00::1  2 ms  3 ms  4 ms',
            success: true,
            exitCode: 0,
          }
        : JSON.stringify({ code: 0, data: null, message: 'success' })
    })
    mockIPC(invokeHandler)

    const { findByRole, findByText } = render(<NetworkDiagnostics />)

    await waitFor(() => expect(invokeHandler).toHaveBeenCalledWith('trace_route', { target: '120.239.74.49' }))
    expect(await findByText(/192\.168\.1\.1/)).toBeTruthy()

    const probeCount = invokeHandler.mock.calls.filter(
      ([command, args]) =>
        command === 'trace_route' && (args as { target?: string } | undefined)?.target === '120.239.74.49',
    ).length
    fireEvent.click(await findByRole('button', { name: 'Probe now' }))
    await waitFor(() => {
      expect(
        invokeHandler.mock.calls.filter(
          ([command, args]) =>
            command === 'trace_route' && (args as { target?: string } | undefined)?.target === '120.239.74.49',
        ),
      ).toHaveLength(probeCount + 1)
    })
    const migratedCache = JSON.parse(localStorage.getItem('zerotier-toolkit.route-traces.v2') ?? '{}')
    expect(migratedCache.a3c1f8a2c9.hops[0].ips).toEqual(['192.168.1.1'])
    expect(migratedCache.a3c1f8a2c9.target).toBe('120.239.74.49')
  })
})
