/** Boot the API server. */

import { createServer } from './index.js';
import { createExporter } from './pipeline/exporter.js';

const port = Number(process.env.PORT ?? 5170);

const app = await createServer({ logger: true, exporter: createExporter });
try {
  const address = await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`guide-studio server listening at ${address}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
