# SSE WS Proxy

Similar to [sockjs](https://github.com/sockjs/sockjs-client), a WebSocket implementation powered by server-sent events.

Unlike sockjs, only one protocol is provided. The idea is this is an explicitly chosen protocol; it's just a worse WebSocket, don't prefer it to real WebSockets. Critically, the browser _must support WebSockets_ to use this library, since the WebSocket global is used in the implementation of the simulated WebSocket.

You need to run a proxy server somewhere and configure clients to use that proxy.

Some networks can't use WebSockets, a proxy like this helps bridge the gap.
