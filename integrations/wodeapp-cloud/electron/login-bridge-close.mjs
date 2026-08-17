export const LOGIN_CANCEL_MARK = "wodeapp-login-cancel";

export function isLoginCancelKey(input) {
  if (!input || input.type !== "keyDown") return false;
  if (input.key !== "Escape") return false;
  if (input.alt || input.control || input.meta || input.shift) return false;
  return true;
}

export function isLoginCancelUrl(url) {
  return typeof url === "string" && url.includes(LOGIN_CANCEL_MARK);
}
