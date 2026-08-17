const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const bridgeUrlEl = document.getElementById("bridgeUrl");
const bridgeTokenEl = document.getElementById("bridgeToken");
const saveButton = document.getElementById("save");
const connectButton = document.getElementById("connect");

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function renderStatus(status) {
  bridgeUrlEl.value = status.bridgeUrl || bridgeUrlEl.value;
  if (status.currentCommand) {
    statusEl.textContent = `Controlling: ${status.currentCommand}`;
  } else if (status.connected) {
    statusEl.textContent = "Connected to WodeAppX bridge.";
  } else if (status.lastError) {
    statusEl.textContent = `Not connected: ${status.lastError}`;
  } else {
    statusEl.textContent = "Not connected.";
  }
  metaEl.textContent = [
    status.clientId ? `Client: ${status.clientId}` : "",
    status.nativeDebugAttached ? "Chrome native debug banner: active" : "",
    status.currentCommandStartedAt ? `Started: ${status.currentCommandStartedAt}` : "",
    status.lastCommandAt ? `Last command: ${status.lastCommandAt}` : "",
    status.lastResultAt ? `Last result: ${status.lastResultAt}` : "",
  ].filter(Boolean).join("\n");
}

async function refresh() {
  const response = await send({ type: "getStatus" });
  if (response?.ok) renderStatus(response.status);
  else statusEl.textContent = response?.error || "Could not read status.";
}

async function saveConfig() {
  saveButton.disabled = true;
  connectButton.disabled = true;
  try {
    const response = await send({
      type: "saveConfig",
      bridgeUrl: bridgeUrlEl.value,
      bridgeToken: bridgeTokenEl.value,
    });
    if (response?.ok) renderStatus(response.status);
    else statusEl.textContent = response?.error || "Save failed.";
  } finally {
    saveButton.disabled = false;
    connectButton.disabled = false;
  }
}

async function connectNow() {
  saveButton.disabled = true;
  connectButton.disabled = true;
  try {
    const response = await send({ type: "connectNow" });
    if (response?.ok) renderStatus(response.status);
    else statusEl.textContent = response?.error || "Connect failed.";
  } finally {
    saveButton.disabled = false;
    connectButton.disabled = false;
  }
}

saveButton.addEventListener("click", () => {
  void saveConfig();
});

connectButton.addEventListener("click", () => {
  void connectNow();
});

void refresh();
setInterval(() => {
  void refresh();
}, 1500);
