import WebSocket, { WebSocketServer } from 'ws';

export interface TestBackendConfig {
  port: number;
}

export interface WSConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(callback: (data: string) => void): void;
  onBinaryMessage(callback: (data: Buffer) => void): void;
  onClose(callback: (code: number, reason: string) => void): void;
  onError(callback: (error: Error) => void): void;
  readonly readyState: number;
}

export class WSTestBackend {
  private server: WebSocketServer | null = null;
  private connection: WebSocket | null = null;
  private connectionPromise: Promise<WSConnection> | null = null;
  
  constructor(private config: TestBackendConfig) {}

  static async create(config: TestBackendConfig): Promise<WSTestBackend> {
    const backend = new WSTestBackend(config);
    await backend.start();
    return backend;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = new WebSocketServer({ port: this.config.port });

      this.server.on('listening', () => {
        console.log(`Test WebSocket backend listening on port ${this.config.port}`);
        // Set up connection handler immediately
        this.setupConnectionHandler();
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  private setupConnectionHandler(): void {
    if (!this.server) return;

    this.server.on('connection', (ws) => {
      if (this.connection) {
        // Only allow one connection - reject immediately
        console.log('Test backend: Rejecting additional connection');
        ws.close(1013, 'Only one connection allowed');
        return;
      }

      console.log('Test backend: Client connected');
      this.connection = ws;

      // Resolve any pending connection promise
      if (this.connectionResolve) {
        const connectionWrapper = this.createConnectionWrapper(ws);
        this.connectionResolve(connectionWrapper);
        this.connectionResolve = null;
        this.connectionPromise = null;
      }

      // Set up cleanup on close
      ws.on('close', () => {
        console.log('Test backend: Client disconnected');
        this.connection = null;
        this.connectionPromise = null;
        this.connectionResolve = null;
      });
    });
  }

  private connectionResolve: ((connection: WSConnection) => void) | null = null;

  async wsConnection(): Promise<WSConnection> {
    if (!this.server) {
      throw new Error('Backend not started. Call start() first.');
    }

    // If we already have a connection, return it
    if (this.connection) {
      return this.createConnectionWrapper(this.connection);
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      this.connectionResolve = resolve;

      const timeout = setTimeout(() => {
        this.connectionResolve = null;
        this.connectionPromise = null;
        reject(new Error('Connection timeout - no client connected within 10 seconds'));
      }, 10000);

      // Store the timeout so we can clear it when connection is made
      const originalResolve = this.connectionResolve;
      this.connectionResolve = (connection: WSConnection) => {
        clearTimeout(timeout);
        originalResolve(connection);
      };
    });

    return this.connectionPromise;
  }

  private createConnectionWrapper(ws: WebSocket): WSConnection {
    return {
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },
      
      close: (code?: number, reason?: string) => {
        ws.close(code, reason);
      },
      
      onMessage: (callback: (data: string) => void) => {
        ws.on('message', (data) => {
          callback(data.toString());
        });
      },
      
      onBinaryMessage: (callback: (data: Buffer) => void) => {
        ws.on('message', (data) => {
          if (Buffer.isBuffer(data)) {
            callback(data);
          } else if (data instanceof ArrayBuffer) {
            callback(Buffer.from(data));
          } else {
            // Convert other types to Buffer
            callback(Buffer.from(data as any));
          }
        });
      },
      
      onClose: (callback: (code: number, reason: string) => void) => {
        ws.on('close', (code, reason) => {
          callback(code, reason.toString());
        });
      },
      
      onError: (callback: (error: Error) => void) => {
        ws.on('error', (error) => {
          console.error('Test backend: WebSocket error:', error);
          callback(error);
        });
      },
      
      get readyState() {
        return ws.readyState;
      }
    };
  }

  hasConnection(): boolean {
    return this.connection !== null && this.connection.readyState === WebSocket.OPEN;
  }

  async stop(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    
    this.connectionPromise = null;

    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        console.log('Test WebSocket backend shut down');
        this.server = null;
        resolve();
      });
    });
  }
}
