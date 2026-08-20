/**
 * Grok Build ACP provider for WodeAppX desktop.
 *
 * Spawns `grok agent stdio` and communicates via JSON-RPC (ACP protocol).
 * The user's existing `grok login` session is preserved; we never ask for passwords.
 *
 * CLI discovery:
 *   1. `grok` in PATH
 *   2. `~/.grok/bin/grok`
 *
 * Auth: uses cached_token from the user's existing `grok login`, or XAI_API_KEY env var.
 *
 * References:
 *   - https://docs.x.ai/build/cli/headless-scripting
 *   - https://agentclientprotocol.com/
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

export const GROK_BUILD_PROVIDER_ID = "grok-build";

/**
 * Discover the Grok Build CLI binary path.
 * Returns null if not found.
 */
export function discoverGrokBuildCli() {
  // Check PATH first
  const pathGrok = "grok";
  
  // Check ~/.grok/bin/grok
  const homeGrok = path.join(os.homedir(), ".grok", "bin", "grok");
  
  // We can't reliably test PATH without spawning, so we'll try both in order
  // and let the spawn attempt fail naturally if neither exists
  if (existsSync(homeGrok)) {
    return homeGrok;
  }
  
  // Return PATH binary name - spawn will fail if it doesn't exist
  return pathGrok;
}

/**
 * Check if Grok Build CLI is available.
 * This is a lightweight check - doesn't spawn a process.
 */
export function isGrokBuildAvailable() {
  const homeGrok = path.join(os.homedir(), ".grok", "bin", "grok");
  if (existsSync(homeGrok)) {
    return true;
  }
  // For PATH binaries, assume available - actual availability checked on spawn
  return true;
}

/**
 * Create an ACP client that communicates with `grok agent stdio`.
 * 
 * Usage:
 *   const client = createGrokBuildAcpClient({ cwd: "/path/to/workspace" });
 *   await client.initialize();
 *   const response = await client.newSession();
 *   const result = await client.prompt("Fix the bug in main.ts");
 *   await client.close();
 */
export function createGrokBuildAcpClient(options = {}) {
  const cwd = options.cwd || process.cwd();
  const model = options.model || "grok-build";
  
  let proc = null;
  let rl = null;
  let messageId = 0;
  let pendingRequests = new Map();
  let sessionId = null;
  let closed = false;

  const client = {
    /**
     * Initialize the ACP connection.
     * Spawns `grok agent stdio` and sends the initialize handshake.
     */
    async initialize() {
      if (proc) {
        throw new Error("Grok Build ACP client already initialized");
      }

      const grokPath = discoverGrokBuildCli();
      if (!grokPath) {
        throw new Error(
          "Grok Build CLI not found. Install it from https://docs.x.ai/build/install or run: npm install -g @xai-official/grok"
        );
      }

      const args = [
        "agent",
        "--always-approve", // Auto-approve tool executions for headless mode
        "--no-auto-update",  // Skip auto-update in automated environments
        "--model", model,
        "stdio"
      ];

      proc = spawn(grokPath, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      rl = readline.createInterface({ input: proc.stdout });

      // Handle incoming messages
      rl.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          
          // Handle JSON-RPC responses
          if (message.id !== undefined && pendingRequests.has(message.id)) {
            const { resolve, reject } = pendingRequests.get(message.id);
            pendingRequests.delete(message.id);
            
            if (message.error) {
              reject(new Error(message.error.message || JSON.stringify(message.error)));
            } else {
              resolve(message.result);
            }
          }
          
          // Handle notifications (session/update events)
          if (message.method && !message.id) {
            // These are streaming updates - could be logged or handled
            // For now, we just let them pass through
          }
        } catch (err) {
          // Ignore parse errors - might be stderr or other output
        }
      });

      // Handle process errors
      proc.on("error", (err) => {
        const error = new Error(
          `Grok Build CLI failed to start: ${err.message}. ` +
          `Make sure 'grok' is installed and available. ` +
          `Install: npm install -g @xai-official/grok`
        );
        for (const { reject } of pendingRequests.values()) {
          reject(error);
        }
        pendingRequests.clear();
      });

      proc.on("exit", (code) => {
        if (!closed && code !== 0) {
          const error = new Error(`Grok Build CLI exited with code ${code}`);
          for (const { reject } of pendingRequests.values()) {
            reject(error);
          }
        }
        pendingRequests.clear();
      });

      // Send initialize request
      const initResult = await client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });

      // Check authentication
      const authMethods = initResult.authMethods || [];
      if (!authMethods.includes("cached_token") && !process.env.XAI_API_KEY) {
        throw new Error(
          "Grok Build not authenticated. Run 'grok login' or set XAI_API_KEY environment variable."
        );
      }

      return initResult;
    },

    /**
     * Send a JSON-RPC request and wait for response.
     */
    async request(method, params = {}) {
      if (!proc || closed) {
        throw new Error("Grok Build ACP client not initialized or already closed");
      }

      const id = ++messageId;
      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        
        // Set timeout for request
        const timeout = setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Grok Build request timed out: ${method}`));
          }
        }, options.requestTimeout || 120000); // 2 minute default timeout

        // Clear timeout when resolved
        const originalResolve = resolve;
        const originalReject = reject;
        pendingRequests.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            originalResolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            originalReject(error);
          },
        });

        try {
          proc.stdin.write(JSON.stringify(message) + "\n");
        } catch (err) {
          clearTimeout(timeout);
          pendingRequests.delete(id);
          reject(err);
        }
      });
    },

    /**
     * Create a new session.
     */
    async newSession() {
      const result = await client.request("session/new", {});
      sessionId = result.sessionId;
      return result;
    },

    /**
     * Send a prompt to the current session.
     */
    async prompt(text) {
      if (!sessionId) {
        await client.newSession();
      }
      
      return client.request("session/prompt", {
        sessionId,
        prompt: text,
      });
    },

    /**
     * Close the ACP connection.
     */
    async close() {
      closed = true;
      if (rl) {
        rl.close();
        rl = null;
      }
      if (proc) {
        proc.stdin.end();
        // Give it a moment to clean up, then kill if still running
        setTimeout(() => {
          if (proc && !proc.killed) {
            proc.kill();
          }
        }, 1000);
        proc = null;
      }
      pendingRequests.clear();
    },

    /**
     * Get the current session ID.
     */
    getSessionId() {
      return sessionId;
    },

    /**
     * Check if the client is initialized.
     */
    isInitialized() {
      return proc !== null && !closed;
    },
  };

  return client;
}

/**
 * Get Grok Build provider configuration for OpenCode managed models.
 * This returns a minimal config that marks Grok Build as available.
 * 
 * The actual ACP communication happens outside OpenCode's provider system -
 * we need a custom integration point in the session/prompt flow.
 */
export function grokBuildProviderConfig() {
  if (!isGrokBuildAvailable()) {
    return null;
  }

  // Return a minimal config to make Grok Build visible in the picker
  // The actual model invocation will be handled by ACP client
  return {
    [GROK_BUILD_PROVIDER_ID]: {
      // Mark as a special "acp" type that doesn't use standard HTTP
      _acpProvider: true,
      name: "Grok Build",
      models: {
        "grok-build": {
          name: "Grok Build (xAI)",
          modalities: { input: ["text"], output: ["text"] },
          attachment: false,
          tool_call: true,
          limit: {
            context: 128_000,
            input: 128_000,
            output: 8_192,
          },
        },
      },
    },
  };
}

/**
 * Test the Grok Build CLI and ACP handshake.
 * Returns { ok: true } on success, { ok: false, error: string } on failure.
 */
export async function testGrokBuildConnection() {
  try {
    const client = createGrokBuildAcpClient();
    await client.initialize();
    await client.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
