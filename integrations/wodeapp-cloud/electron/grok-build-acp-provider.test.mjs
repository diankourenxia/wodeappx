/**
 * Tests for Grok Build ACP provider.
 * 
 * These tests mock the grok CLI process and verify the ACP handshake logic
 * without requiring a live SuperGrok account.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
  discoverGrokBuildCli,
  isGrokBuildAvailable,
  createGrokBuildAcpClient,
  grokBuildProviderConfig,
  GROK_BUILD_PROVIDER_ID,
} from "./grok-build-acp-provider.mjs";

// Mock spawn for testing
class MockProcess extends EventEmitter {
  constructor() {
    super();
    this.stdin = {
      write: (data) => {
        this.stdinData = (this.stdinData || "") + data;
        return true;
      },
      end: () => {
        this.stdinEnded = true;
      },
    };
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
    this.stdinData = "";
    this.stdinEnded = false;
  }

  kill() {
    this.killed = true;
    this.emit("exit", 0);
  }

  simulateStdout(data) {
    this.stdout.emit("data", Buffer.from(data + "\n"));
  }
}

test("discoverGrokBuildCli returns a path", () => {
  const path = discoverGrokBuildCli();
  assert.ok(path, "Should return a CLI path");
  assert.ok(typeof path === "string", "Path should be a string");
});

test("isGrokBuildAvailable returns boolean", () => {
  const available = isGrokBuildAvailable();
  assert.equal(typeof available, "boolean");
});

test("grokBuildProviderConfig returns valid config structure", () => {
  const config = grokBuildProviderConfig();
  
  if (config) {
    assert.ok(config[GROK_BUILD_PROVIDER_ID], "Should have grok-build provider");
    assert.ok(config[GROK_BUILD_PROVIDER_ID]._acpProvider, "Should be marked as ACP provider");
    assert.equal(config[GROK_BUILD_PROVIDER_ID].name, "Grok Build");
    assert.ok(config[GROK_BUILD_PROVIDER_ID].models["grok-build"], "Should have grok-build model");
    
    const model = config[GROK_BUILD_PROVIDER_ID].models["grok-build"];
    assert.equal(model.name, "Grok Build (xAI)");
    assert.equal(model.tool_call, true);
    assert.ok(model.limit, "Should have context limits");
  }
});

test("createGrokBuildAcpClient returns client interface", () => {
  const client = createGrokBuildAcpClient();
  
  assert.equal(typeof client.initialize, "function");
  assert.equal(typeof client.request, "function");
  assert.equal(typeof client.newSession, "function");
  assert.equal(typeof client.prompt, "function");
  assert.equal(typeof client.close, "function");
  assert.equal(typeof client.getSessionId, "function");
  assert.equal(typeof client.isInitialized, "function");
});

test("ACP client initialize sequence (mocked)", async () => {
  let mockProc = null;
  
  // Mock spawn
  const originalSpawn = globalThis.spawn;
  globalThis.spawn = function(command, args, options) {
    mockProc = new MockProcess();
    
    // Simulate successful initialize response after a short delay
    setImmediate(() => {
      mockProc.simulateStdout(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          authMethods: ["cached_token", "grok.com"],
          capabilities: {},
        },
      }));
    });
    
    return mockProc;
  };
  
  try {
    const client = createGrokBuildAcpClient({ cwd: "/tmp/test" });
    
    // Should not be initialized yet
    assert.equal(client.isInitialized(), false);
    
    // Initialize
    const initResult = await client.initialize();
    
    // Verify initialize response
    assert.equal(initResult.protocolVersion, 1);
    assert.ok(Array.isArray(initResult.authMethods));
    assert.ok(initResult.authMethods.includes("cached_token"));
    
    // Should be initialized now
    assert.equal(client.isInitialized(), true);
    
    // Check that correct args were passed
    assert.ok(mockProc.stdinData.includes('"method":"initialize"'));
    
    // Cleanup
    await client.close();
    assert.ok(mockProc.stdinEnded, "stdin should be closed");
  } finally {
    globalThis.spawn = originalSpawn;
  }
});

test("ACP client handles missing auth gracefully", async () => {
  let mockProc = null;
  
  const originalSpawn = globalThis.spawn;
  const originalEnv = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  
  globalThis.spawn = function(command, args, options) {
    mockProc = new MockProcess();
    
    setImmediate(() => {
      // Simulate response with no auth methods (not logged in)
      mockProc.simulateStdout(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          authMethods: [], // No auth available
          capabilities: {},
        },
      }));
    });
    
    return mockProc;
  };
  
  try {
    const client = createGrokBuildAcpClient();
    
    await assert.rejects(
      async () => {
        await client.initialize();
      },
      /not authenticated|grok login|XAI_API_KEY/i,
      "Should reject with auth error"
    );
    
    await client.close();
  } finally {
    globalThis.spawn = originalSpawn;
    if (originalEnv) {
      process.env.XAI_API_KEY = originalEnv;
    }
  }
});

test("ACP client request timeout", async () => {
  let mockProc = null;
  
  const originalSpawn = globalThis.spawn;
  globalThis.spawn = function(command, args, options) {
    mockProc = new MockProcess();
    
    // Simulate successful initialize
    setImmediate(() => {
      mockProc.simulateStdout(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          authMethods: ["cached_token"],
          capabilities: {},
        },
      }));
    });
    
    // Never respond to subsequent requests
    
    return mockProc;
  };
  
  try {
    const client = createGrokBuildAcpClient({ requestTimeout: 100 }); // 100ms timeout
    await client.initialize();
    
    await assert.rejects(
      async () => {
        await client.request("session/new", {});
      },
      /timed out/i,
      "Should timeout on unresponsive request"
    );
    
    await client.close();
  } finally {
    globalThis.spawn = originalSpawn;
  }
});

test("ACP client processes JSON-RPC messages correctly", async () => {
  let mockProc = null;
  
  const originalSpawn = globalThis.spawn;
  globalThis.spawn = function(command, args, options) {
    mockProc = new MockProcess();
    
    setImmediate(() => {
      // Initialize response
      mockProc.simulateStdout(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: 1,
          authMethods: ["cached_token"],
        },
      }));
      
      // Session response
      setTimeout(() => {
        mockProc.simulateStdout(JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          result: {
            sessionId: "test-session-123",
          },
        }));
      }, 10);
    });
    
    return mockProc;
  };
  
  try {
    const client = createGrokBuildAcpClient();
    await client.initialize();
    
    const sessionResult = await client.newSession();
    assert.equal(sessionResult.sessionId, "test-session-123");
    assert.equal(client.getSessionId(), "test-session-123");
    
    await client.close();
  } finally {
    globalThis.spawn = originalSpawn;
  }
});

test("ACP client handles process errors", async () => {
  const originalSpawn = globalThis.spawn;
  
  globalThis.spawn = function(command, args, options) {
    const mockProc = new MockProcess();
    
    // Simulate process error
    setImmediate(() => {
      mockProc.emit("error", new Error("Command not found"));
    });
    
    return mockProc;
  };
  
  try {
    const client = createGrokBuildAcpClient();
    
    await assert.rejects(
      async () => {
        await client.initialize();
      },
      /failed to start|not found/i,
      "Should handle spawn errors"
    );
  } finally {
    globalThis.spawn = originalSpawn;
  }
});
