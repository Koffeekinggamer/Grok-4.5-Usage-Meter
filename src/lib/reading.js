"use strict";

const { readGrokAccount } = require("./auth");
const { fetchBilling } = require("./usage");
const { readActiveContext } = require("./context");

/**
 * @typedef {{ kind: 'missing-auth'|'unsigned-in'|'expired'|'http'|'parse'|'unknown', message: string }} Fault
 * @typedef {{
 *   percent: number,
 *   used: number|null,
 *   limit: number|null,
 *   remaining: number|null,
 *   planPercentUsed: number,
 *   contextPercentUsed: number|null,
 *   onDemandPercentUsed: number|null,
 *   onDemandUsed: number|null,
 *   onDemandCap: number|null,
 *   contextTokensUsed: number|null,
 *   contextWindowTokens: number|null,
 *   model: string|null,
 *   sessionId: string|null,
 *   membershipType: string|null,
 *   isUnlimited: boolean,
 *   billingCycleStart: string|null,
 *   billingCycleEnd: string|null,
 *   displayMessage: string|null,
 *   email: string|null,
 * }} Reading
 */

/**
 * Classify a thrown error into a Fault.
 * @param {unknown} err
 * @returns {Fault}
 */
function classifyFault(err) {
  const message = err instanceof Error ? err.message : String(err);

  if (/auth file not found/i.test(message)) {
    return { kind: "missing-auth", message };
  }
  if (/access token expired|token expired/i.test(message)) {
    return { kind: "expired", message };
  }
  if (/No access token|run `?grok login/i.test(message)) {
    return { kind: "unsigned-in", message };
  }
  if (/billing failed/i.test(message)) {
    return { kind: "http", message };
  }
  if (/billing response is empty|auth\.json is not valid JSON|invalid/i.test(message)) {
    return { kind: "parse", message };
  }
  return { kind: "unknown", message };
}

/**
 * Produce a Reading for the signed-in Grok account, or a Fault.
 * @param {{
 *   authPath?: string,
 *   fetchImpl?: typeof fetch,
 *   endpoint?: string,
 *   readAccount?: typeof readGrokAccount,
 *   fetchBillingFn?: typeof fetchBilling,
 *   readContext?: typeof readActiveContext,
 * }} [opts]
 * @returns {Promise<{ ok: true, reading: Reading } | { ok: false, fault: Fault }>}
 */
async function takeReading(opts = {}) {
  const readAccount = opts.readAccount || readGrokAccount;
  const fetchBillingFn = opts.fetchBillingFn || fetchBilling;
  const readContext = opts.readContext || readActiveContext;

  try {
    const account = readAccount({ authPath: opts.authPath });
    const billing = await fetchBillingFn({
      accessToken: account.accessToken,
      fetchImpl: opts.fetchImpl,
      endpoint: opts.endpoint,
    });
    const context = readContext() || null;

    const planPercent = billing.percent;
    const contextPercent =
      context && Number.isFinite(context.percent) ? context.percent : null;

    let displayMessage = null;
    if (billing.limit != null) {
      displayMessage = `Plan ${Math.round(planPercent)}% of included Grok usage`;
    }
    if (contextPercent != null) {
      displayMessage = displayMessage
        ? `${displayMessage} · Ctx ${Math.round(contextPercent)}%`
        : `Context ${Math.round(contextPercent)}%`;
    }

    return {
      ok: true,
      reading: {
        percent: planPercent,
        used: billing.used,
        limit: billing.limit,
        remaining: billing.remaining,
        planPercentUsed: planPercent,
        contextPercentUsed: contextPercent,
        onDemandPercentUsed: billing.onDemandPercent,
        onDemandUsed: billing.onDemandUsed,
        onDemandCap: billing.onDemandCap,
        contextTokensUsed: context?.tokensUsed ?? null,
        contextWindowTokens: context?.windowTokens ?? null,
        model: context?.model ?? "grok-4.5",
        sessionId: context?.sessionId ?? null,
        membershipType: "grok",
        isUnlimited: billing.isUnlimited,
        billingCycleStart: billing.billingCycleStart,
        billingCycleEnd: billing.billingCycleEnd,
        displayMessage,
        email: account.email,
      },
    };
  } catch (err) {
    return { ok: false, fault: classifyFault(err) };
  }
}

module.exports = {
  classifyFault,
  takeReading,
};
