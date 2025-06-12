# SSE WS Proxy

Similar to [sockjs](https://github.com/sockjs/sockjs-client), provide something that looks like a WebSocket but is powered by server-sent events.

Unlike sockjs, only one protocol is provided. The idea is this is an explicitly chosen protocol; it's just a worse WebSocket, don't prefer it to real WebSockets.

You need to run a proxy server somewhere and configure clients to use that proxy.

Some networks can't use WebSockets, a proxy like this helps bridge the gap.
