import { createServer } from 'node:net'

/** Fixed default port of the hosted runtime; occupied ports move to the next one. */
export const DEFAULT_PORT = 43110

const MAX_PROBES = 20

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

/** Find the first free loopback port at or after `start`. */
export async function findFreePort(start: number = DEFAULT_PORT): Promise<number> {
  for (let port = start; port < start + MAX_PROBES; port += 1) {
    if (await probe(port)) return port
  }
  throw new Error(`no free loopback port in ${String(start)}..${String(start + MAX_PROBES - 1)}`)
}
