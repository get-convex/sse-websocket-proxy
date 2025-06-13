import { describe, it, expect } from "vitest";
import { SimulatedWebsocket } from "./node.js";

describe("SimulatedWebsocket Basic Tests", () => {
  it("should create a SimulatedWebsocket instance", () => {
    const ws = new SimulatedWebsocket("ws://localhost:8123", undefined, "http://localhost:3002");

    expect(ws).toBeDefined();
    expect(ws.url).toBe("ws://localhost:8123");
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    expect(ws.protocol).toBe("");
    expect(ws.extensions).toBe("");

    // Clean up - close the connection
    ws.close();
  });

  it("should have WebSocket constants available via WebSocket", () => {
    expect(WebSocket.CONNECTING).toBe(0);
    expect(WebSocket.OPEN).toBe(1);
    expect(WebSocket.CLOSING).toBe(2);
    expect(WebSocket.CLOSED).toBe(3);
  });

  it("should extend EventTarget", () => {
    const ws = new SimulatedWebsocket("ws://localhost:8123", undefined, "http://localhost:3002");

    // Should be an instance of EventTarget
    expect(ws instanceof EventTarget).toBe(true);

    // Should have EventTarget methods
    expect(typeof ws.addEventListener).toBe("function");
    expect(typeof ws.removeEventListener).toBe("function");
    expect(typeof ws.dispatchEvent).toBe("function");

    ws.close();
  });
});

