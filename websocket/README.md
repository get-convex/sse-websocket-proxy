the simulated websocket

```
import { createProxiedWebSocketClass } from "@convex-dev/sse-proxied-websocket";
const ProxiedWebSocket = createProxiedWebSocketClass("https://your-proxy.example.com");
// this works like a normal WebSocket
// (but you need to configure the proxy
// to allow this url)
const ws = new ProxiedWebSocket(url)

```

### Dev notes

Using Vitest 2.\* because in 3 custom conditions dont' see to be respected right now.

see https://github.com/vitest-dev/vitest/issues/5301
