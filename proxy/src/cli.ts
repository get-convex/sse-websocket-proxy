#!/usr/bin/env node

/**
 * CLI script for running the SSE WebSocket Proxy
 * Usage: node cli.js [backend-url] [proxy-port]
 * Example: node cli.js wss://happy-animal-123.convex.cloud 3001
 */

import { SSEWebSocketProxy } from './index.js';

// Configuration from command line args
const BACKEND_URL = process.argv[2] || 'http://localhost:8000';
const PROXY_PORT = parseInt(process.argv[3]) || 3001;

async function main() {
  const proxy = new SSEWebSocketProxy({
    backendUrl: BACKEND_URL,
    port: PROXY_PORT
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await proxy.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await proxy.stop();
    process.exit(0);
  });

  // Start the proxy server
  try {
    await proxy.start();
  } catch (error) {
    console.error('Failed to start proxy server:', error);
    process.exit(1);
  }
}

main().catch(console.error);