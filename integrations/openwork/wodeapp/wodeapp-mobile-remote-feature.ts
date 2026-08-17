/**
 * Desktop 「手机端」云中转遥控。
 *
 * 当前路径硬依赖 WodeApp API Key / 登录后才能 register relay；
 * 纯本机 BYOK、无平台身份时不可用。产品决策：先隐藏入口，等
 * 登录可选 / 本机 LAN 配对落地后再打开。
 *
 * Flip to true when shipping that path.
 */
export const WODEAPP_MOBILE_REMOTE_ENABLED = false;
