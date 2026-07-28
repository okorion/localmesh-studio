import { Server } from "@hocuspocus/server";

const port = Number(process.env.COLLABORATION_PORT ?? 1234);

const server = new Server({
  port,
  timeout: 30_000,
  debounce: 500,
  maxDebounce: 2_000,
});

await server.listen();

console.log(`[collaboration] WebSocket server listening on ws://localhost:${port}`);
