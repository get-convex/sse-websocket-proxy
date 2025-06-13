the proxy

### Dev notes

We're using the ws WebSocket instead of native Node.js WebSockets because we're responsible for things like 1001
exit codes that a real implementation (like the Node.js one) won't let you manually create.
