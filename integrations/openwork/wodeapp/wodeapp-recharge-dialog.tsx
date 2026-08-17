/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import {
  Check,
  CheckCircle2,
  Coins,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

import { requestWodeAppMainJson } from "@/app/lib/wodeapp-auth";
import { usePlatform } from "@/react-app/kernel/platform";

import "./wodeapp-legacy-chrome.css";

type RechargeView = "subscription" | "credits";
type BillingCycle = "monthly" | "yearly";
type PayMethod = "alipay" | "wechat";
type CheckoutStatus = "idle" | "creating" | "pending" | "paid" | "error";

type PriceItem = {
  id: string;
  name: string;
  price: number;
  priceYuan: string;
  currency: string;
  credits: number;
  interval?: "month" | "year";
  seats?: number;
  maxVideos?: number;
  product?: string;
};

type PricesResponse = {
  success: boolean;
  data?: {
    subscriptions?: PriceItem[];
    creditPacks?: PriceItem[];
  };
  error?: string;
};

type PaymentStatusResponse = {
  success: boolean;
  data?: { configured?: boolean };
};

type CheckoutResponse = {
  success: boolean;
  data?: {
    outTradeNo?: string;
    amount?: string;
    qrCode?: string;
    codeUrl?: string;
    url?: string;
    h5Url?: string;
  };
  error?: string;
};

type OrderResponse = {
  success: boolean;
  data?: { status?: string };
  error?: string;
};

type CheckoutState = {
  method: PayMethod;
  outTradeNo: string;
  amount: string;
  itemName: string;
  qrDataUrl: string | null;
  openedExternally: boolean;
};

type WodeAppRechargeDialogProps = {
  open: boolean;
  credits: number | null;
  onClose: () => void;
  onCreditsChanged?: () => void | Promise<void>;
};

const PLAN_ORDER = [
  "wodeappx_personal",
  "wodeappx_small_team",
  "wodeappx_brand_team",
  "wodeappx_enterprise",
];

const PLAN_COPY: Record<string, { description: string }> = {
  wodeappx_personal: {
    description: "日常对话、图片与建站；不含视频生成额度",
  },
  wodeappx_small_team: {
    description: "更多积分，可轻度出几条商品短视频",
  },
  wodeappx_brand_team: {
    description: "正经出视频：分镜、批量与素材生产",
  },
  wodeappx_enterprise: {
    description: "多人协作，高频商品视频与内容生产",
  },
};

const DEFAULT_PLAN_ID = "wodeappx_personal";
const RECOMMENDED_YEARLY_PLAN_ID = "wodeappx_brand_team";

const FALLBACK_TEAM_PLANS: PriceItem[] = [
  {
    id: "wodeappx_personal_monthly",
    name: "WodeAppX 个人版 月付",
    price: 8800,
    priceYuan: "88",
    currency: "CNY",
    credits: 2000,
    interval: "month",
    seats: 1,
    maxVideos: 0,
    product: "wodeappx",
  },
  {
    id: "wodeappx_personal_yearly",
    name: "WodeAppX 个人版 年付",
    price: 88000,
    priceYuan: "880",
    currency: "CNY",
    credits: 24000,
    interval: "year",
    seats: 1,
    maxVideos: 0,
    product: "wodeappx",
  },
  {
    id: "wodeappx_small_team_monthly",
    name: "WodeAppX 个人专业版 月付",
    price: 16800,
    priceYuan: "168",
    currency: "CNY",
    credits: 4200,
    interval: "month",
    seats: 1,
    maxVideos: 12,
    product: "wodeappx",
  },
  {
    id: "wodeappx_small_team_yearly",
    name: "WodeAppX 个人专业版 年付",
    price: 168000,
    priceYuan: "1680",
    currency: "CNY",
    credits: 50400,
    interval: "year",
    seats: 1,
    maxVideos: 144,
    product: "wodeappx",
  },
  {
    id: "wodeappx_brand_team_monthly",
    name: "WodeAppX 视频版 月付",
    price: 38800,
    priceYuan: "388",
    currency: "CNY",
    credits: 12000,
    interval: "month",
    seats: 1,
    maxVideos: 60,
    product: "wodeappx",
  },
  {
    id: "wodeappx_brand_team_yearly",
    name: "WodeAppX 视频版 年付",
    price: 388000,
    priceYuan: "3880",
    currency: "CNY",
    credits: 144000,
    interval: "year",
    seats: 1,
    maxVideos: 720,
    product: "wodeappx",
  },
  {
    id: "wodeappx_enterprise_monthly",
    name: "WodeAppX 视频团队版 月付",
    price: 88000,
    priceYuan: "880",
    currency: "CNY",
    credits: 28000,
    interval: "month",
    seats: 5,
    maxVideos: 200,
    product: "wodeappx",
  },
  {
    id: "wodeappx_enterprise_yearly",
    name: "WodeAppX 视频团队版 年付",
    price: 880000,
    priceYuan: "8800",
    currency: "CNY",
    credits: 336000,
    interval: "year",
    seats: 5,
    maxVideos: 2400,
    product: "wodeappx",
  },
];

const CNY_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function planBaseId(id: string): string {
  return id.replace(/_(monthly|yearly)$/, "");
}

function displayPlanName(item: PriceItem): string {
  return item.name
    .replace(/\s*(月付|年付)\s*$/, "")
    .trim();
}

function formatYuan(value: string | number): string {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? CNY_FORMATTER.format(amount) : String(value);
}

function itemPriceYuan(item: PriceItem): number {
  const explicit = Number(item.priceYuan);
  if (Number.isFinite(explicit)) return explicit;
  return item.price / 100;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function WodeAppRechargeDialog({
  open,
  credits,
  onClose,
  onCreditsChanged,
}: WodeAppRechargeDialogProps) {
  const platform = usePlatform();
  const dialogRef = React.useRef<HTMLElement>(null);
  const [view, setView] = React.useState<RechargeView>("subscription");
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>("monthly");
  const [payMethod, setPayMethod] = React.useState<PayMethod>("alipay");
  const [subscriptions, setSubscriptions] = React.useState<PriceItem[]>([]);
  const [creditPacks, setCreditPacks] = React.useState<PriceItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = React.useState(DEFAULT_PLAN_ID);
  const [selectedPackId, setSelectedPackId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = React.useState<CheckoutStatus>("idle");
  const [checkout, setCheckout] = React.useState<CheckoutState | null>(null);
  const [teamCheckoutReady, setTeamCheckoutReady] = React.useState(false);
  const [monthlyCheckoutReady, setMonthlyCheckoutReady] = React.useState(false);
  const [availableMethods, setAvailableMethods] = React.useState<Record<PayMethod, boolean>>({
    alipay: false,
    wechat: false,
  });

  const loadPrices = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [prices, alipayStatus, wechatStatus] = await Promise.all([
        requestWodeAppMainJson<PricesResponse>("/alipay/prices"),
        requestWodeAppMainJson<PaymentStatusResponse>("/alipay/status").catch(() => null),
        requestWodeAppMainJson<PaymentStatusResponse>("/wechatpay/status").catch(() => null),
      ]);
      if (!prices.success || !prices.data) {
        throw new Error(prices.error || "暂未读取到套餐信息");
      }
      const nextSubscriptions = (prices.data.subscriptions || []).filter((item) =>
        PLAN_ORDER.includes(planBaseId(item.id)),
      );
      const hasCompleteYearlyCatalog = PLAN_ORDER.every((planId) =>
        nextSubscriptions.some((item) => planBaseId(item.id) === planId && item.id.endsWith("_yearly")),
      );
      const hasCompleteMonthlyCatalog = PLAN_ORDER.every((planId) =>
        nextSubscriptions.some((item) => planBaseId(item.id) === planId && item.id.endsWith("_monthly")),
      );
      const personalMonthly = nextSubscriptions.find((item) => item.id === "wodeappx_personal_monthly");
      const personalMonthlyYuan = personalMonthly ? itemPriceYuan(personalMonthly) : NaN;
      // New ladder is ¥88 personal. Old ¥680 catalog must not paint over the
      // revised offer; keep display on fallback until mainserver ships the new prices.
      const serverMatchesNewLadder = Number.isFinite(personalMonthlyYuan) && personalMonthlyYuan <= 120;
      const nextPacks = prices.data.creditPacks || [];
      setSubscriptions(
        hasCompleteYearlyCatalog && hasCompleteMonthlyCatalog && serverMatchesNewLadder
          ? nextSubscriptions
          : FALLBACK_TEAM_PLANS,
      );
      setTeamCheckoutReady(hasCompleteYearlyCatalog && serverMatchesNewLadder);
      setMonthlyCheckoutReady(hasCompleteYearlyCatalog && hasCompleteMonthlyCatalog && serverMatchesNewLadder);
      setCreditPacks(nextPacks);
      const alipayAvailable = Boolean(alipayStatus?.success && alipayStatus.data?.configured);
      const wechatAvailable = Boolean(wechatStatus?.success && wechatStatus.data?.configured);
      setAvailableMethods({ alipay: alipayAvailable, wechat: wechatAvailable });
      if (!alipayAvailable && wechatAvailable) {
        setPayMethod("wechat");
      } else if (alipayAvailable) {
        setPayMethod("alipay");
      }
      const firstPack = nextPacks[0];
      if (firstPack) setSelectedPackId((current) => current || firstPack.id);
    } catch (error) {
      setLoadError(errorMessage(error, "套餐加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setView("subscription");
    setBillingCycle("monthly");
    setSelectedPlanId(DEFAULT_PLAN_ID);
    setCheckout(null);
    setCheckoutError(null);
    setCheckoutStatus("idle");
    setTeamCheckoutReady(false);
    setMonthlyCheckoutReady(false);
    void loadPrices();
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [loadPrices, open]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || checkoutStatus === "creating") return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkoutStatus, onClose, open]);

  const activePlans = React.useMemo(() => {
    const suffix = billingCycle === "monthly" ? "_monthly" : "_yearly";
    return subscriptions
      .filter((item) => item.id.endsWith(suffix))
      .sort((left, right) => PLAN_ORDER.indexOf(planBaseId(left.id)) - PLAN_ORDER.indexOf(planBaseId(right.id)));
  }, [billingCycle, subscriptions]);

  const subscriptionCheckoutReady = billingCycle === "monthly" ? monthlyCheckoutReady : teamCheckoutReady;
  const recommendedPlanId = billingCycle === "monthly" ? DEFAULT_PLAN_ID : RECOMMENDED_YEARLY_PLAN_ID;

  React.useEffect(() => {
    if (!activePlans.length) return;
    if (!activePlans.some((item) => planBaseId(item.id) === selectedPlanId)) {
      setSelectedPlanId(planBaseId(activePlans[0].id));
    }
  }, [activePlans, selectedPlanId]);

  const selectedPlan = activePlans.find((item) => planBaseId(item.id) === selectedPlanId) || null;
  const selectedPack = creditPacks.find((item) => item.id === selectedPackId) || null;
  const selectedItem = view === "subscription" ? selectedPlan : selectedPack;

  const selectSubscriptionView = React.useCallback(() => {
    setView("subscription");
    setCheckoutError(null);
  }, []);

  const selectCreditsView = React.useCallback(() => {
    setView("credits");
    setCheckoutError(null);
  }, []);

  const selectMonthlyCycle = React.useCallback(() => {
    setBillingCycle("monthly");
    setSelectedPlanId(DEFAULT_PLAN_ID);
    setCheckoutError(null);
  }, []);

  const selectYearlyCycle = React.useCallback(() => {
    setBillingCycle("yearly");
    setCheckoutError(null);
  }, []);

  const selectAlipay = React.useCallback(() => {
    setPayMethod("alipay");
    setCheckoutError(null);
  }, []);
  const selectWechat = React.useCallback(() => {
    setPayMethod("wechat");
    setCheckoutError(null);
  }, []);

  const handlePlanSelect = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const planId = event.currentTarget.dataset.planId;
    if (planId) setSelectedPlanId(planId);
  }, []);

  const handlePackSelect = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const packId = event.currentTarget.dataset.packId;
    if (packId) setSelectedPackId(packId);
  }, []);

  const handleBackdropClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && checkoutStatus !== "creating") onClose();
  }, [checkoutStatus, onClose]);

  const handleRetry = React.useCallback(() => void loadPrices(), [loadPrices]);

  const resetCheckout = React.useCallback(() => {
    setCheckout(null);
    setCheckoutError(null);
    setCheckoutStatus("idle");
  }, []);

  const handleCheckout = React.useCallback(async () => {
    if (!selectedItem || checkoutStatus === "creating") return;
    if (view === "subscription" && !subscriptionCheckoutReady) {
      setCheckoutError(
        billingCycle === "monthly"
          ? "月付套餐尚未发布到主服务，请完成更新后重试"
          : "团队套餐支付服务尚未发布，请完成主服务更新后重试",
      );
      return;
    }
    if (!availableMethods[payMethod]) {
      setCheckoutError("当前支付方式暂未开通，请选择其他方式");
      return;
    }

    setCheckoutStatus("creating");
    setCheckoutError(null);
    try {
      const isSubscription = view === "subscription";
      const endpoint = `/${payMethod === "wechat" ? "wechatpay" : "alipay"}/checkout/${isSubscription ? "subscription" : "credits"}`;
      // Prefer page-pay URL: merchant Alipay app lacks 当面付 (precreate →
      // ACCESS_FORBIDDEN). Client opens `url` via platform.openLink.
      const requestBody = isSubscription
        ? {
            planId: selectedPlanId,
            billingCycle,
          }
        : { packId: selectedPackId };
      const response = await requestWodeAppMainJson<CheckoutResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      if (!response.success || !response.data?.outTradeNo) {
        throw new Error(response.error || "创建支付订单失败");
      }

      const payTarget = response.data.qrCode || response.data.codeUrl || null;
      const externalUrl = response.data.url || response.data.h5Url || null;
      let qrDataUrl: string | null = null;
      if (payTarget) {
        qrDataUrl = await QRCode.toDataURL(payTarget, {
          width: 224,
          margin: 1,
          color: { dark: "#151821", light: "#ffffff" },
        });
      } else if (externalUrl) {
        await platform.openLink(externalUrl);
      } else {
        throw new Error("支付链接生成失败，请稍后重试");
      }

      setCheckout({
        method: payMethod,
        outTradeNo: response.data.outTradeNo,
        amount: response.data.amount || formatYuan(itemPriceYuan(selectedItem)),
        itemName: displayPlanName(selectedItem),
        qrDataUrl,
        openedExternally: Boolean(externalUrl && !payTarget),
      });
      setCheckoutStatus("pending");
    } catch (error) {
      setCheckoutError(errorMessage(error, "创建支付订单失败"));
      setCheckoutStatus("error");
    }
  }, [
    availableMethods,
    billingCycle,
    checkoutStatus,
    payMethod,
    platform,
    selectedItem,
    selectedPackId,
    selectedPlanId,
    subscriptionCheckoutReady,
    view,
  ]);

  React.useEffect(() => {
    if (!open || checkoutStatus !== "pending" || !checkout) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const prefix = checkout.method === "wechat" ? "wechatpay" : "alipay";
        const result = await requestWodeAppMainJson<OrderResponse>(
          `/${prefix}/order/${encodeURIComponent(checkout.outTradeNo)}`,
        );
        if (!stopped && result.success && result.data?.status === "paid") {
          setCheckoutStatus("paid");
          try {
            window.dispatchEvent(new Event("wodeapp:auth-changed"));
          } catch {
            // ignore
          }
          await onCreditsChanged?.();
          return;
        }
      } catch {
        // Keep polling: a single network error should not interrupt an active payment.
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3000);
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [checkout, checkoutStatus, onCreditsChanged, open]);

  if (!open) return null;

  const checkoutLabel = selectedItem
    ? view === "subscription" && !subscriptionCheckoutReady
      ? "支付服务更新中"
      : `${payMethod === "wechat" ? "微信支付" : "支付宝"} ¥${formatYuan(itemPriceYuan(selectedItem))}`
    : "选择套餐";

  // Mount on document.body: sidebar skins use `contain: paint`, which makes
  // position:fixed descendants size to the 300px sidebar instead of the viewport.
  return createPortal(
    <div className="wx-recharge-backdrop" role="presentation" onMouseDown={handleBackdropClick}>
      <section
        ref={dialogRef}
        className="wx-recharge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wx-recharge-title"
        tabIndex={-1}
      >
        <header className="wx-recharge-header">
          <div className="wx-recharge-title-mark" aria-hidden>
            <Coins />
          </div>
          <div className="wx-recharge-heading">
            <h2 id="wx-recharge-title">购买 WodeAppX 套餐</h2>
            <p>
              当前余额
              <strong>{typeof credits === "number" ? credits.toLocaleString() : "同步中"}</strong>
              积分
            </p>
          </div>
          <button type="button" className="wx-recharge-close" onClick={onClose} aria-label="关闭充值窗口">
            <X aria-hidden />
          </button>
        </header>

        <div className="wx-recharge-body">
          {checkout ? (
            <div className="wx-recharge-payment-state">
              {checkoutStatus === "paid" ? (
                <>
                  <div className="wx-recharge-payment-icon is-success" aria-hidden>
                    <CheckCircle2 />
                  </div>
                  <h3>支付成功</h3>
                  <p>套餐与积分已到账，余额正在同步。</p>
                  <button type="button" className="wx-recharge-payment-done" onClick={onClose}>
                    完成
                  </button>
                </>
              ) : (
                <>
                  <div className="wx-recharge-payment-summary">
                    <span>{checkout.itemName}</span>
                    <strong>¥{formatYuan(checkout.amount)}</strong>
                  </div>
                  {checkout.qrDataUrl ? (
                    <img className="wx-recharge-qr" src={checkout.qrDataUrl} alt="支付二维码" />
                  ) : (
                    <div className="wx-recharge-external-pay">
                      <CreditCard aria-hidden />
                      <strong>已在浏览器打开付款页面</strong>
                      <span>完成付款后回到 WodeAppX，积分会自动同步。</span>
                    </div>
                  )}
                  <h3>{checkout.qrDataUrl ? `请使用${checkout.method === "wechat" ? "微信" : "支付宝"}扫码` : "等待付款"}</h3>
                  <p>支付完成前请保留此窗口，到账状态会自动刷新。</p>
                  <div className="wx-recharge-polling">
                    <Loader2 aria-hidden />
                    正在确认支付结果
                  </div>
                  <button type="button" className="wx-recharge-payment-cancel" onClick={resetCheckout}>
                    返回套餐
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="wx-recharge-toolbar">
                <div className="wx-recharge-view-tabs" role="tablist" aria-label="充值类型">
                  <button
                    type="button"
                    className={view === "subscription" ? "is-active" : ""}
                    onClick={selectSubscriptionView}
                    role="tab"
                    aria-selected={view === "subscription"}
                  >
                    订阅套餐
                  </button>
                  <button
                    type="button"
                    className={view === "credits" ? "is-active" : ""}
                    onClick={selectCreditsView}
                    role="tab"
                    aria-selected={view === "credits"}
                  >
                    追加积分
                  </button>
                </div>

                {view === "subscription" ? (
                  <div className="wx-recharge-cycle" role="tablist" aria-label="计费周期">
                    <button
                      type="button"
                      className={billingCycle === "monthly" ? "is-active" : ""}
                      onClick={selectMonthlyCycle}
                      role="tab"
                      aria-selected={billingCycle === "monthly"}
                    >
                      月付
                    </button>
                    <button
                      type="button"
                      className={billingCycle === "yearly" ? "is-active" : ""}
                      onClick={selectYearlyCycle}
                      role="tab"
                      aria-selected={billingCycle === "yearly"}
                    >
                      年付
                      <span>更省</span>
                    </button>
                  </div>
                ) : null}
              </div>

              {loading ? (
                <div className="wx-recharge-loading">
                  <Loader2 aria-hidden />
                  <span>正在读取最新套餐</span>
                </div>
              ) : loadError ? (
                <div className="wx-recharge-error-state">
                  <p>{loadError}</p>
                  <button type="button" onClick={handleRetry}>
                    <RefreshCw aria-hidden />
                    重新加载
                  </button>
                </div>
              ) : view === "subscription" ? (
                <div className="wx-recharge-plan-section">
                  {!subscriptionCheckoutReady ? (
                    <p className="wx-recharge-service-notice">
                      {billingCycle === "monthly"
                        ? "新价格已展示；主服务发布新报价后即可按下单金额支付。"
                        : "新价格已展示；主服务发布新报价后即可按下单金额支付。"}
                    </p>
                  ) : null}
                  <div className={`wx-recharge-plan-grid${activePlans.length === 1 ? " is-single" : ""}`}>
                    {activePlans.map((item) => {
                    const baseId = planBaseId(item.id);
                    const isSelected = baseId === selectedPlanId;
                    const currentPrice = itemPriceYuan(item);
                    const copy = PLAN_COPY[baseId] || { description: "适合团队持续使用 WodeAppX" };
                    const seatCount = item.seats || 1;
                    const videoCount = item.maxVideos || 0;
                    const isMonthly = billingCycle === "monthly";
                    const monthlyCounterpart = subscriptions.find((plan) => plan.id === `${baseId}_monthly`);
                    const yearlySaving = !isMonthly && monthlyCounterpart
                      ? Math.round(itemPriceYuan(monthlyCounterpart) * 12 - currentPrice)
                      : 0;
                      return (
                        <button
                        type="button"
                        key={item.id}
                        data-plan-id={baseId}
                        className={`wx-recharge-plan${isSelected ? " is-selected" : ""}${baseId === recommendedPlanId ? " is-recommended" : ""}`}
                        onClick={handlePlanSelect}
                        aria-pressed={isSelected}
                      >
                        {baseId === recommendedPlanId ? <span className="wx-recharge-recommended">推荐</span> : null}
                        <span className="wx-recharge-plan-name">{displayPlanName(item)}</span>
                        <span className="wx-recharge-plan-description">{copy.description}</span>
                        <span className="wx-recharge-plan-price">
                          <small>¥</small>
                          <strong>{formatYuan(currentPrice)}</strong>
                          <small>/{isMonthly ? "月" : "年"}</small>
                        </span>
                        <span className="wx-recharge-plan-saving">
                          {isMonthly
                            ? "按月开通，降低起步门槛"
                            : yearlySaving > 0
                              ? `比月付省 ¥${formatYuan(yearlySaving)}`
                              : "包年使用，按报价单购买"}
                        </span>
                        <span className="wx-recharge-plan-divider" />
                        <span className="wx-recharge-plan-feature">
                          <UsersRound aria-hidden />
                          {seatCount} 个使用席位
                        </span>
                        <span className="wx-recharge-plan-feature">
                          <Check aria-hidden />
                          {videoCount > 0
                            ? `最多 ${videoCount.toLocaleString()} 条商品视频${isMonthly ? "/月" : ""}`
                            : "不含视频生成额度（对话 / 图片 / 建站）"}
                        </span>
                        <span className="wx-recharge-plan-feature">
                          <Check aria-hidden />
                          {isMonthly
                            ? `${item.credits.toLocaleString()} 积分/月 · 脚本素材与日常创作`
                            : "脚本、素材、协作与持续创作"}
                        </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="wx-recharge-pack-section">
                  <p className="wx-recharge-pack-note">套餐积分用尽后，可按需追加积分继续生产。</p>
                  <div className="wx-recharge-pack-grid">
                    {creditPacks.map((item) => {
                      const isSelected = item.id === selectedPackId;
                      return (
                        <button
                          type="button"
                          key={item.id}
                          data-pack-id={item.id}
                          className={`wx-recharge-pack${isSelected ? " is-selected" : ""}`}
                          onClick={handlePackSelect}
                          aria-pressed={isSelected}
                        >
                          <Coins aria-hidden />
                          <span className="wx-recharge-pack-copy">
                            <strong>{item.credits.toLocaleString()} 积分</strong>
                            <small>{item.name}</small>
                          </span>
                          <span className="wx-recharge-pack-price">¥{formatYuan(itemPriceYuan(item))}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!checkout ? (
          <footer className="wx-recharge-footer">
            <div className="wx-recharge-trust">
              <ShieldCheck aria-hidden />
              <span>权益与积分支付后立即开通</span>
            </div>
            <div className="wx-recharge-methods" aria-label="支付方式">
              <button
                type="button"
                className={payMethod === "alipay" ? "is-active is-alipay" : ""}
                onClick={selectAlipay}
                disabled={!availableMethods.alipay}
              >
                支付宝
              </button>
              <button
                type="button"
                className={payMethod === "wechat" ? "is-active is-wechat" : ""}
                onClick={selectWechat}
                disabled={!availableMethods.wechat}
              >
                微信支付
              </button>
            </div>
            <button
              type="button"
              className="wx-recharge-submit"
              onClick={handleCheckout}
              disabled={
                !selectedItem
                || loading
                || checkoutStatus === "creating"
                || !availableMethods[payMethod]
                || (view === "subscription" && !subscriptionCheckoutReady)
              }
            >
              {checkoutStatus === "creating" ? (
                <>
                  <Loader2 aria-hidden />
                  正在创建订单
                </>
              ) : (
                checkoutLabel
              )}
            </button>
            {checkoutError ? <p className="wx-recharge-footer-error">{checkoutError}</p> : null}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
