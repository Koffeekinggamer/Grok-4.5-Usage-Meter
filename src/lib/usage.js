"use strict";

const DEFAULT_BILLING_ENDPOINT = "https://cli-chat-proxy.grok.com/v1/billing";

/**
 * Unwrap `{ val: number }` or bare number fields from the billing API.
 * @param {unknown} wrapped
 * @returns {number|null}
 */
function unwrapVal(wrapped) {
  if (wrapped == null) return null;
  if (typeof wrapped === "number" && Number.isFinite(wrapped)) return wrapped;
  if (typeof wrapped === "object" && wrapped !== null && "val" in wrapped) {
    const n = Number(/** @type {{ val: unknown }} */ (wrapped).val);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(wrapped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a CLI billing payload into gauge-friendly metrics.
 * @param {any} billing
 */
function parseBilling(billing) {
  if (!billing || typeof billing !== "object") {
    throw new Error("billing response is empty");
  }

  const config = billing.config ?? billing;
  const used = unwrapVal(config.used) ?? 0;
  const monthlyLimit = unwrapVal(config.monthlyLimit);
  const onDemandCap = unwrapVal(config.onDemandCap) ?? 0;
  const onDemandUsed = unwrapVal(config.onDemandUsed) ?? 0;

  let percent = 0;
  if (monthlyLimit != null && monthlyLimit > 0) {
    percent = (used / monthlyLimit) * 100;
  } else if (monthlyLimit === 0 && used === 0) {
    percent = 0;
  } else if (monthlyLimit == null) {
    // Unlimited / unknown — treat as 0 on the plan needle.
    percent = 0;
  }

  percent = Math.max(0, Math.min(percent, 150));

  let onDemandPercent = null;
  if (onDemandCap > 0) {
    onDemandPercent = Math.max(
      0,
      Math.min((onDemandUsed / onDemandCap) * 100, 150)
    );
  }

  // CLI always returns a numeric monthlyLimit for plan users; null/missing = unlimited.
  const isUnlimited = monthlyLimit == null;

  return {
    percent: isUnlimited ? 0 : percent,
    used,
    limit: monthlyLimit,
    remaining:
      monthlyLimit != null ? Math.max(0, monthlyLimit - used) : null,
    onDemandCap,
    onDemandUsed,
    onDemandPercent,
    isUnlimited,
    billingCycleStart: config.billingPeriodStart ?? null,
    billingCycleEnd: config.billingPeriodEnd ?? null,
    history: Array.isArray(config.history) ? config.history : [],
  };
}

/**
 * Fetch Grok plan billing for the signed-in account.
 * @param {{
 *   accessToken: string,
 *   fetchImpl?: typeof fetch,
 *   endpoint?: string,
 * }} opts
 */
async function fetchBilling(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this Node runtime");
  }

  const endpoint = opts.endpoint || DEFAULT_BILLING_ENDPOINT;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: "application/json",
      "User-Agent": "GrokUsageMeter/1.0",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `billing failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ""}`
    );
  }

  const json = await response.json();
  return parseBilling(json);
}

/**
 * Map percent used to needle angle.
 * Face sweeps from -120° (0%) to +120° (100%); overshoot to +150° at 125%+.
 * @param {number} percent
 */
function percentToNeedleAngle(percent) {
  const p = Math.max(0, Math.min(Number(percent) || 0, 125));
  const start = -120;
  const end = 120;
  const t = p / 100;
  return start + (end - start) * Math.min(t, 1) + (t > 1 ? ((t - 1) / 0.25) * 30 : 0);
}

module.exports = {
  unwrapVal,
  parseBilling,
  fetchBilling,
  percentToNeedleAngle,
  DEFAULT_BILLING_ENDPOINT,
};
