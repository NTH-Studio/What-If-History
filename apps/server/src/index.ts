import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';

const { app, database } = createApp();
const server = app.listen(config.port, config.host, () => {
  const localAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry?.address}:${config.port}`);
  console.log(
    JSON.stringify({
      event: 'server.ready',
      local: `http://127.0.0.1:${config.port}`,
      lan: localAddresses,
      database: config.databasePath,
    }),
  );
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'server.shutdown', signal }));
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
