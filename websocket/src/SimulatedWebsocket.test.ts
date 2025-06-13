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

    // Clean up
    ws.close();
  });

  it("should be an instance of EventTarget", () => {
    const ws = new SimulatedWebsocket("ws://localhost:8123", undefined, "http://localhost:3002");

    expect(ws instanceof EventTarget).toBe(true);
    expect(typeof ws.addEventListener).toBe("function");
    expect(typeof ws.removeEventListener).toBe("function");
    expect(typeof ws.dispatchEvent).toBe("function");

    ws.close();
  });

  it("should have WebSocket-style event handlers", () => {
    const ws = new SimulatedWebsocket("ws://localhost:8123", undefined, "http://localhost:3002");

    expect(ws.onopen).toBeNull();
    expect(ws.onmessage).toBeNull();
    expect(ws.onerror).toBeNull();
    expect(ws.onclose).toBeNull();

    ws.close();
  });
});
