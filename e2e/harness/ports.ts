import net from 'node:net';

export function getFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate TCP port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

export async function getFreePorts(count: number, host = '127.0.0.1'): Promise<number[]> {
  const ports = new Set<number>();
  while (ports.size < count) {
    ports.add(await getFreePort(host));
  }
  return Array.from(ports);
}
