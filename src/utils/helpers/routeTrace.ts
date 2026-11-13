export type RouteHop = {
  index: number
  ip?: string
  ips: string[]
  rtts: number[]
  probes: number
  lossHistory: number[]
  lossPercent: number
}

export const parseRouteHops = (output: string): RouteHop[] => {
  const hops: RouteHop[] = []
  let lastHop: RouteHop | undefined

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/)
    const body = match?.[2] ?? line.trim()
    const ip = body.match(/(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F]*:[0-9a-fA-F:]+/)?.[0]
    const rtts = [...body.matchAll(/<?\s*(\d+(?:\.\d+)?)\s*ms/gi)].map((item) => Number(item[1]))
    if (match) {
      const hop: RouteHop = {
        index: Number(match[1]),
        ip,
        ips: ip ? [ip] : [],
        rtts,
        probes: 3,
        lossHistory: [],
        lossPercent: 0,
      }
      hops.push(hop)
      lastHop = hop
    } else if (lastHop && (ip || rtts.length)) {
      if (ip && !lastHop.ips.includes(ip)) lastHop.ips.push(ip)
      if (!lastHop.ip && ip) lastHop.ip = ip
      lastHop.rtts.push(...rtts)
    } else {
      continue
    }

    const lost = Math.max(0, 3 - lastHop.rtts.length)
    lastHop.lossHistory = [lost]
    lastHop.lossPercent = Math.round((lost / 3) * 100)
  }

  return hops
}

export const mergeRouteHops = (previous: RouteHop[], current: RouteHop[]): RouteHop[] =>
  current.map((hop) => {
    const previousHop = previous.find(({ index }) => index === hop.index)
    const lossHistory = [...(previousHop?.lossHistory ?? []), 3 - hop.rtts.length].slice(-10)
    const probes = lossHistory.length * 3
    const rtts = [...(previousHop?.rtts ?? []), ...hop.rtts].slice(-30)
    return {
      index: hop.index,
      ip: hop.ip ?? previousHop?.ip,
      ips: hop.ips.length ? hop.ips : (previousHop?.ips ?? []),
      rtts,
      probes,
      lossHistory,
      lossPercent: Math.round((lossHistory.reduce((sum, lost) => sum + lost, 0) / probes) * 100),
    }
  })
