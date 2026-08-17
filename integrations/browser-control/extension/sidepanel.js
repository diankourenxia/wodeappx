const STORAGE_KEY = "wodeappxBrowserSidePanelV1";
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:17654";
const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") || "empty";

const elements = {
  connectionLabel: document.getElementById("connectionLabel"),
  newTaskButton: document.getElementById("newTaskButton"),
  settingsButton: document.getElementById("settingsButton"),
  settingsPanel: document.getElementById("settingsPanel"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  bridgeUrl: document.getElementById("bridgeUrl"),
  bridgeToken: document.getElementById("bridgeToken"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  settingsStatus: document.getElementById("settingsStatus"),
  targetState: document.getElementById("targetState"),
  targetTitle: document.getElementById("targetTitle"),
  targetUrl: document.getElementById("targetUrl"),
  conversation: document.getElementById("conversation"),
  emptyState: document.getElementById("emptyState"),
  messageList: document.getElementById("messageList"),
  thinkingRow: document.getElementById("thinkingRow"),
  composerForm: document.getElementById("composerForm"),
  promptInput: document.getElementById("promptInput"),
  sendButton: document.getElementById("sendButton"),
};

const state = {
  sessionId: "",
  messages: [],
  busy: false,
  target: null,
};

function extensionRuntimeAvailable() {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.runtime?.sendMessage);
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setConnection(text, tone = "") {
  elements.connectionLabel.textContent = text;
  elements.connectionLabel.className = tone;
}

function connectedLabel(status) {
  if (status?.transport === "native_messaging") return "WodeAppX 已连接 · 本机宿主";
  if (status?.transport === "localhost_http_fallback") return "WodeAppX 已连接 · 兼容模式";
  return "WodeAppX 已连接";
}

function setTarget(target) {
  state.target = target || null;
  const supported = Boolean(target?.supported);
  elements.targetTitle.textContent = target?.title || "当前页面不可用";
  elements.targetUrl.textContent = target?.url || "请切换到普通网页";
  elements.targetState.className = `target-state ${supported ? "ready" : "blocked"}`;
}

function makeMessageElement(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}${message.error ? " error" : ""}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = message.role === "user" ? "你" : "WodeAppX";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message.content;
  article.append(label, body);
  return article;
}

function renderMessages() {
  elements.messageList.replaceChildren(...state.messages.map(makeMessageElement));
  elements.emptyState.hidden = state.messages.length > 0;
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
}

async function persistConversation() {
  if (!extensionRuntimeAvailable()) return;
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      sessionId: state.sessionId,
      messages: state.messages.slice(-40),
    },
  });
}

async function restoreConversation() {
  if (!extensionRuntimeAvailable()) return;
  const stored = await chrome.storage.local.get({ [STORAGE_KEY]: null });
  const saved = stored?.[STORAGE_KEY];
  state.sessionId = String(saved?.sessionId || "");
  state.messages = Array.isArray(saved?.messages)
    ? saved.messages.filter((item) => item?.role && typeof item.content === "string").slice(-40)
    : [];
}

function setBusy(busy) {
  state.busy = busy;
  elements.sendButton.disabled = busy;
  elements.promptInput.disabled = busy;
  elements.thinkingRow.hidden = !busy;
  if (busy) scrollToLatest();
}

function addMessage(role, content, error = false) {
  state.messages.push({ role, content: String(content || ""), error });
  renderMessages();
  scrollToLatest();
}

function resizeComposer() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 132)}px`;
}

async function refreshStatus() {
  if (!extensionRuntimeAvailable()) {
    setConnection("界面预览", "connected");
    const previewTargets = {
      form: { title: "新建客户", url: "merchant.example.com/customers/new", supported: true },
      result: { title: "导出中心", url: "merchant.example.com/exports", supported: true },
    };
    setTarget(previewTargets[DEMO_MODE] || { title: "订单管理", url: "merchant.example.com/orders", supported: true });
    return;
  }
  try {
    const [statusResponse, targetResponse] = await Promise.all([
      send({ type: "getStatus" }),
      send({ type: "getActiveTab" }),
    ]);
    if (statusResponse?.ok) {
      const status = statusResponse.status || {};
      elements.bridgeUrl.value = status.bridgeUrl || DEFAULT_BRIDGE_URL;
      if (status.connected && status.chatReady) setConnection(connectedLabel(status), "connected");
      else if (status.connected) setConnection("等待 WodeAppX 会话", "");
      else setConnection("尚未连接", status.lastError ? "error" : "");
    }
    if (targetResponse?.ok) setTarget(targetResponse.target);
  } catch (error) {
    setConnection("连接失败", "error");
    elements.settingsStatus.textContent = String(error?.message || error);
  }
}

async function submitPrompt(rawPrompt) {
  const prompt = String(rawPrompt || "").trim();
  if (!prompt || state.busy) return;
  addMessage("user", prompt);
  elements.promptInput.value = "";
  resizeComposer();
  setBusy(true);
  await persistConversation();

  if (!extensionRuntimeAvailable()) {
    window.setTimeout(() => {
      addMessage("assistant", "这是侧栏界面预览。安装扩展并保持 WodeAppX 打开后，我会读取当前网页并执行这个任务。", true);
      setBusy(false);
    }, 450);
    return;
  }

  try {
    const response = await send({
      type: "sidePanelChat",
      sessionId: state.sessionId,
      prompt,
    });
    if (!response?.ok) throw new Error(response?.error || "WodeAppX 未返回结果");
    const data = response.data || {};
    state.sessionId = String(data.sessionId || state.sessionId || "");
    addMessage("assistant", data.reply || "WodeAppX 已完成本轮处理。");
    setConnection("WodeAppX 已连接", "connected");
  } catch (error) {
    addMessage("assistant", `${String(error?.message || error)}\n\n请保持 WodeAppX 桌面端打开，或在“设置”中检查本地桥接地址。`, true);
    setConnection("需要检查连接", "error");
  } finally {
    setBusy(false);
    await persistConversation();
    elements.promptInput.focus();
  }
}

async function newTask() {
  state.sessionId = "";
  state.messages = [];
  renderMessages();
  await persistConversation();
  elements.promptInput.focus();
}

function setSettingsOpen(open) {
  elements.settingsPanel.hidden = !open;
  elements.settingsButton.setAttribute("aria-expanded", String(open));
  if (open) elements.bridgeUrl.focus();
}

async function saveSettings() {
  if (!extensionRuntimeAvailable()) {
    elements.settingsStatus.textContent = "界面预览中";
    return;
  }
  elements.saveSettingsButton.disabled = true;
  elements.settingsStatus.textContent = "正在连接";
  try {
    const response = await send({
      type: "saveConfig",
      bridgeUrl: elements.bridgeUrl.value,
      bridgeToken: elements.bridgeToken.value,
    });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    elements.settingsStatus.textContent = response.status?.connected ? "已连接" : "已保存，等待 WodeAppX";
    await refreshStatus();
  } catch (error) {
    elements.settingsStatus.textContent = String(error?.message || error);
  } finally {
    elements.saveSettingsButton.disabled = false;
  }
}

function seedDemo(mode) {
  if (extensionRuntimeAvailable() || !mode || mode === "empty") return;
  const samples = {
    summary: [
      { role: "user", content: "总结当前页面，并告诉我有哪些待处理订单" },
      { role: "assistant", content: "当前是订单管理页，共有 18 条待处理订单。主要集中在华东和华南区域，其中 3 条已超过承诺发货时间。\n\n我可以继续筛选逾期订单，或把结果导出为 CSV。" },
    ],
    form: [
      { role: "user", content: "把当前客户资料填进这个表单，提交前让我确认" },
      { role: "assistant", content: "已读取表单并填写姓名、公司、联系电话和收货地址。付款方式与备注仍为空，我没有提交。\n\n请确认页面中的内容，确认后我再继续。" },
    ],
    result: [
      { role: "user", content: "筛选今天的待处理订单并导出" },
      { role: "assistant", content: "已完成：筛选到 18 条今日待处理订单，并开始下载 CSV 文件。页面没有发现错误提示。" },
    ],
  };
  state.messages = samples[mode] || [];
  renderMessages();
  if (mode === "settings") setSettingsOpen(true);
}

elements.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPrompt(elements.promptInput.value);
});

elements.promptInput.addEventListener("input", resizeComposer);
elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submitPrompt(elements.promptInput.value);
  }
});

elements.newTaskButton.addEventListener("click", () => void newTask());
elements.settingsButton.addEventListener("click", () => setSettingsOpen(elements.settingsPanel.hidden));
elements.closeSettingsButton.addEventListener("click", () => setSettingsOpen(false));
elements.saveSettingsButton.addEventListener("click", () => void saveSettings());

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.promptInput.value = button.getAttribute("data-prompt") || "";
    resizeComposer();
    elements.promptInput.focus();
  });
});

async function initialize() {
  await restoreConversation();
  renderMessages();
  seedDemo(DEMO_MODE);
  resizeComposer();
  await refreshStatus();
  if (extensionRuntimeAvailable()) {
    window.setInterval(() => void refreshStatus(), 5000);
  }
}

void initialize();
