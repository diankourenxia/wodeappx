import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, "../fork/apps/app/src/react-app/domains/wodeapp/wodeapp-account-footer.tsx"),
  join(here, "../wodeapp/wodeapp-account-footer.tsx"),
];
const footerPath = candidates.find((path) => existsSync(path));
const dialogPath = join(here, "../wodeapp/wodeapp-cloud-region-dialog.tsx");

describe("wodeapp cloud login", () => {
  test("opens official website login instead of in-app verification codes", () => {
    expect(footerPath).toBeTruthy();
    const source = readFileSync(footerPath!, "utf8");
    const dialog = readFileSync(dialogPath, "utf8");
    expect(source).toContain("WodeAppCloudRegionDialog");
    expect(source).toContain("WodeAppCloudLoginWaitingDialog");
    expect(source).toContain("signInWithWodeApp");
    expect(source).toContain("正在打开浏览器登录...");
    expect(source).toContain("登录成功，初始化中");
    expect(source).toContain("登录成功");
    expect(source).toContain("openDesktopUrl");
    expect(source).toContain("wodeAppCloudPricingUrl");
    expect(source).not.toContain("WodeAppRechargeDialog");
    expect(source).not.toContain("onCnSignedIn");
    expect(source).not.toContain("WodeAppLoginDialog");
    expect(dialog).toContain("正在浏览器中登录");
    expect(dialog).toContain("登录成功");
    expect(dialog).toContain("初始化中");
    expect(dialog).toContain("浏览器打开官网");
    expect(dialog).toContain('onPick("cn")');
    expect(dialog).not.toContain("sendWodeAppLoginCode");
    expect(dialog).not.toContain("loginWithWodeAppCode");
    expect(dialog).not.toContain("获取验证码");
    expect(dialog).not.toContain("应用内手机号登录");
    expect(dialog).not.toContain("send-email-code");
  });
});
