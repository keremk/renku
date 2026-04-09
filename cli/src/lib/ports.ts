import net from 'node:net';

export async function findAvailablePort(preferred?: number): Promise<number> {
  if (preferred) {
    const available = await isPortAvailable(preferred);
    if (available) {
      return preferred;
    }
  }

  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port);
        } else {
          reject(new Error('Unable to determine assigned port'));
        }
      });
    });
  });
}

export async function isPortAvailable(
  port: number,
  host = '127.0.0.1'
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}
