## This is beta software

This package is not officially supported by Convex, it's a proof of concept for now. If this is a service you need, let us know.

# SSE WS Proxy

Similar to [sockjs](https://github.com/sockjs/sockjs-client), a WebSocket implementation powered by server-sent events.

Unlike sockjs, only one protocol is provided. The idea is this is an explicitly chosen protocol; it's just a worse WebSocket, don't prefer it to real WebSockets. Critically, the browser _must support WebSockets_ to use this library, since the WebSocket global is used in the implementation of the simulated WebSocket.

You need to run a proxy server somewhere and configure clients to use that proxy.

Some networks can't use WebSockets, a proxy like this helps bridge the gap.

# Example

After building (`pnpm i; pnpm run -r build`), in three separate terminals run:

A WebSocket server. Install `websocat` with brew or something.
Once the client connects, you can type here to send it messages

```
websocat -s 1234
```

The proxy. This runs the real WebSockets that talk to the WebSocket server.

```
cd proxy
SSE_WS_PROXY_HEALTH_SECRET=weak_secret node dist/cli.js --allow-any-localhost-port --verbose
```

The client. Be sure to use Node.js 22 like it says in the .nvmrc file.

```
cd websocket
node --version # should be v22.something
node
process.env.SSE_WS_VERBOSE=1
const { createProxiedWebSocketClass } = await import ("./dist/node.js");
const ProxiedWebSocket = createProxiedWebSocketClass("http://127.0.0.1:3001");
const ws = new ProxiedWebSocket('http://127.0.0.1:1234')
ws.onmessage = (e) => console.log(e.data)
ws.send('hello')
```

In a fourth terminal you can get info about connected sessions.

```
curl 'http://localhost:3001/health?secret=weak_secret' | jq
```
