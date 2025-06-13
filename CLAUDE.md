This is a project to try to imitate a WebSocket for browsers where WebSockets exist, but get cut off by the
network for some reason. The proxy directory implements a proxy that listens to /sse and /messages among other
endpoints, and creates real websockets to talk to the websocket server that the client wants to talk to.

THe project uses pnpm.

All tests are run with `pnpm run -r test`.
