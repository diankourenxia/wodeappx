const { ipcRenderer } = require("electron");

const NATIVE_CLOSE = "[data-wodeapp-desktop-login-close]";
const INJECTED_ID = "wodeapp-desktop-login-close";

function cancelLogin() {
  try {
    ipcRenderer.send("wodeapp:login-cancel");
  } catch {
    // ignore
  }
  try {
    window.close();
  } catch {
    // ignore
  }
}

function injectCloseButton() {
  const native = document.querySelector(NATIVE_CLOSE);
  const injected = document.getElementById(INJECTED_ID);
  if (native) {
    injected?.remove();
    return;
  }
  if (injected || !document.body) return;

  const btn = document.createElement("button");
  btn.id = INJECTED_ID;
  btn.type = "button";
  btn.setAttribute("aria-label", "关闭");
  btn.textContent = "关闭";
  btn.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:12px",
    "z-index:2147483647",
    "height:32px",
    "padding:0 12px",
    "border:0",
    "border-radius:999px",
    "background:#ffffff",
    "color:#334155",
    "font:600 13px/32px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif",
    "box-shadow:0 1px 4px rgba(15,23,42,.18)",
    "cursor:pointer",
  ].join(";");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancelLogin();
  });
  document.body.appendChild(btn);
}

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelLogin();
    }
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    const card = document.querySelector("[data-wodeapp-desktop-login-card]");
    if (!card || !(event.target instanceof Node)) return;
    if (!card.contains(event.target)) cancelLogin();
  },
  true,
);

const sync = () => injectCloseButton();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", sync, { once: true });
} else {
  sync();
}
const observer = new MutationObserver(sync);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("unload", () => observer.disconnect(), { once: true });
