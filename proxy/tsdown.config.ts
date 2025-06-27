import { defineConfig } from 'tsdown'
import { readFileSync } from 'node:fs'

const packageVersion = process.env.npm_package_version ?? JSON.parse(readFileSync('./package.json', 'utf-8')).version

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/ws-test-backend.ts', 'src/sse-protocol.ts', 'src/messages-protocol.ts'],
  format: ['esm', 'cjs'],
  platform: 'node',
  dts: {},
  exports: {
    devExports: 'sse-ws-proxy-development',
  },
  sourcemap: true,
  clean: true, // (this is the default)
  // Compiled-in variables
  env: {
    npm_package_version: packageVersion,
  },
})
