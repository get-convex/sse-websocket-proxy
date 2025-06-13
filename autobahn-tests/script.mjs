import getPort from "get-port";
import { SimulatedWebsocket } from "sse-proxied-websocket/node";
import { SSEWebSocketProxy } from "sse-websocket-proxy";

async function runTests() {
  const agent = "Proxied SSE WebSocket";

  try {
    const caseCount = await getCaseCount();
    console.log(`Running ${caseCount} test cases...`);

    for (let i = 1; i <= caseCount; i++) {
      console.log(`Running case ${i}/${caseCount}`);
      await runCase(i, agent);
      // Small delay between tests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await updateReports(agent);
    console.log("Tests completed! Check ./reports/ for results.");
  } catch (error) {
    console.error("Test run failed:", error);
  }
}

function getCaseCount() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:9001/getCaseCount");

    ws.addEventListener("open", () => {
      console.log("Connected to get case count");
    });

    ws.addEventListener("message", (msg) => {
      resolve(parseInt(msg.data.toString()));
      ws.close();
    });

    ws.addEventListener("error", reject);
  });
}

async function runCase(caseNum, agent) {
  const PROXY_PORT = await getPort();

  const proxy = new SSEWebSocketProxy({
    port: PROXY_PORT,
    backendUrl: `ws://localhost:9001`,
  });
  await proxy.start();

  await new Promise((resolve, reject) => {
    const ws = new SimulatedWebsocket(
      `ws://localhost:9001/runCase?case=${caseNum}&agent=${agent}`,
      undefined,
      `http://localhost:${PROXY_PORT}`,
    );

    ws.onopen = () => {
      // Case is ready to start
    };

    ws.onmessage = (data) => {
      // Echo back exactly what we received
      try {
        ws.send(data);
      } catch (error) {
        // Connection might be closing
        console.log(`Case ${caseNum}: Send failed, connection likely closing`);
      }
    };

    ws.onclose = (code, reason) => {
      resolve();
    };

    ws.onerror = (error) => {
      console.log(`Case ${caseNum}: Error - ${error.message}`);
      resolve(); // Don't reject, continue with other tests
    };
  });

  await proxy.stop();

  return;
}

function updateReports(agent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:9001/updateReports?agent=${agent}`);
    ws.addEventListener("open", () => {
      console.log("Updating reports...");
    });

    ws.addEventListener("close", () => {
      resolve();
    });

    ws.addEventListener("error", reject);
  });
}

// Run the tests
runTests();
