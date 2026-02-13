/**
 * @module api/start
 * Standalone entry point: loads env, inits DB, starts the API server.
 */

import { env } from "../soterflow-env.js";
import { getDb } from "../store/db.js";
import { createServer } from "./server.js";

const port = env.SOTERFLOW_API_PORT;

getDb(); // ensure DB is initialized
const { server } = createServer();

server.listen(port, () => {
  console.log(`[soterflow] API server listening on http://localhost:${port}`);
});
