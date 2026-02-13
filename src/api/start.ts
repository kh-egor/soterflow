/**
 * @module api/start
 * Standalone entry point: loads env, inits DB, starts the API server with graceful shutdown.
 */

import { env } from "../soterflow-env.js";
import { getDb } from "../store/db.js";
import { createServer, gracefulShutdown } from "./server.js";

const port = env.SOTERFLOW_API_PORT;

getDb(); // ensure DB is initialized
const { server, wss } = createServer();

server.listen(port, () => {
  console.log(`[soterflow] API server listening on http://localhost:${port}`);
});

// Graceful shutdown on SIGINT/SIGTERM
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[soterflow] Received ${signal}, shutting down...`);
    void gracefulShutdown(server, wss).then(() => process.exit(0));
  });
}
