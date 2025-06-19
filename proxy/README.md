SSE to WebSocket proxy.

This package is not officially supported by Convex, it's a proof of concept for now. If this is a service you need, let us know.

### Dev notes

We're using the ws WebSocket instead of native Node.js WebSockets because we're responsible for things like 1001
exit codes that a real implementation (like the Node.js one) won't let you manually create.
