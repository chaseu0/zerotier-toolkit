import { mergeRouteHops, parseRouteHops } from '../routeTrace.ts'

describe('parseRouteHops', () => {
  it('parses IPv4 hops with multiple RTT samples and non-responsive hops', () => {
    expect(parseRouteHops('traceroute to 1.2.3.4\n 1  192.168.1.1  1.2 ms  2 ms  1.4 ms\n 2  * * *')).toEqual([
      {
        index: 1,
        ip: '192.168.1.1',
        ips: ['192.168.1.1'],
        rtts: [1.2, 2, 1.4],
        probes: 3,
        lossHistory: [0],
        lossPercent: 0,
      },
      { index: 2, ip: undefined, ips: [], rtts: [], probes: 3, lossHistory: [3], lossPercent: 100 },
    ])
  })

  it('parses Windows tracert output', () => {
    expect(parseRouteHops(' 1    <1 ms    2 ms    3 ms  10.0.0.1')).toEqual([
      { index: 1, ip: '10.0.0.1', ips: ['10.0.0.1'], rtts: [1, 2, 3], probes: 3, lossHistory: [0], lossPercent: 0 },
    ])
  })

  it('parses IPv6 router addresses from traceroute6 output', () => {
    expect(parseRouteHops('traceroute6 to fd00::2\n 1  240e:3bb:ac4:bad1::1  0.6 ms  0.4 ms  0.4 ms')).toEqual([
      {
        index: 1,
        ip: '240e:3bb:ac4:bad1::1',
        ips: ['240e:3bb:ac4:bad1::1'],
        rtts: [0.6, 0.4, 0.4],
        probes: 3,
        lossHistory: [0],
        lossPercent: 0,
      },
    ])
  })

  it('groups wrapped traceroute6 responses into the preceding hop', () => {
    expect(
      parseRouteHops(
        ' 6  240e:187:c101:101::2be  3.7 ms\n    240e:187:c101:101::2c2  2.8 ms *\n    240e:187:c101:101::2be  3 ms',
      ),
    ).toEqual([
      {
        index: 6,
        ip: '240e:187:c101:101::2be',
        ips: ['240e:187:c101:101::2be', '240e:187:c101:101::2c2'],
        rtts: [3.7, 2.8, 3],
        probes: 3,
        lossHistory: [0],
        lossPercent: 0,
      },
    ])
  })

  it('keeps a rolling loss history across scans of the same hop', () => {
    const previous = parseRouteHops(' 1  192.0.2.1  1 ms  2 ms  3 ms')
    const current = parseRouteHops(' 1  192.0.2.1  4 ms')

    expect(mergeRouteHops(previous, current)).toEqual([
      {
        index: 1,
        ip: '192.0.2.1',
        ips: ['192.0.2.1'],
        rtts: [1, 2, 3, 4],
        probes: 6,
        lossHistory: [0, 2],
        lossPercent: 33,
      },
    ])
  })
})
