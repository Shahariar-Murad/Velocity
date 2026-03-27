
export type Row = Record<string, any>;

export type Settings = {
  excludePsps: string[];
  timezoneOffset: number;
  retryWindowMinutes: number;
  highVelocity5m: number;
  highVelocity15m: number;
  highVelocity60m: number;
};

type Kpi = { label: string; value: string; note?: string };

export type AnalysisResult = {
  filteredCount: number;
  totalCount: number;
  kpis: Kpi[];
  topPsps: any[];
  topCountries: any[];
  declineReasons: any[];
  declineCategories: any[];
  highRiskEntities: any[];
  velocity5m: any[];
  velocity15m: any[];
  velocity60m: any[];
  retrySummary: any[];
  recoveredRetries: any[];
  flaggedTransactions: any[];
};

const FRAUD_RE = /(fraud|riskmanagement|risk management|avs|banned card|blacklist|stolen|pickup|security|velocity)/i;
const AUTH_RE = /(3d|authentication|cvv|cvc|secure verification)/i;
const FUNDS_RE = /(insufficient|not sufficient funds)/i;
const ISSUER_RE = /(do not honor|authorization system|issuer|not supported\/blocked)/i;
const CUSTOMER_RE = /(expired|canceled by the user|cancelled by the user|transaction expired)/i;

function normalize(value: any): string {
  return String(value ?? "").trim();
}

function toNumber(value: any): number {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: any, timezoneOffset = 6): number {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getTime() + timezoneOffset * 60 * 60 * 1000;
}

function keyOf(...parts: any[]): string {
  return parts.map(normalize).filter(Boolean).join("|");
}

function groupCount<T extends Row>(rows: T[], keyFn: (r: T) => string) {
  const map = new Map<string, T[]>();
  rows.forEach((r) => {
    const key = keyFn(r);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  });
  return map;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function summarizeVelocity(rows: Row[], entityKey: (r: Row) => string, minutes: number, threshold: number) {
  const byEntity = groupCount(rows, entityKey);
  const result: any[] = [];

  byEntity.forEach((items, entity) => {
    const sorted = [...items].sort((a, b) => a.__ts - b.__ts);
    let left = 0;
    let bestWindow = 0;
    let approvedInBest = 0;
    let declinedInBest = 0;
    let bestStart = 0;
    let bestEnd = 0;

    for (let right = 0; right < sorted.length; right++) {
      while (sorted[right].__ts - sorted[left].__ts > minutes * 60 * 1000) left++;
      const windowRows = sorted.slice(left, right + 1);
      if (windowRows.length > bestWindow) {
        bestWindow = windowRows.length;
        approvedInBest = windowRows.filter((r) => r.statusNorm === "approved").length;
        declinedInBest = windowRows.filter((r) => r.statusNorm === "declined").length;
        bestStart = windowRows[0].__ts;
        bestEnd = windowRows[windowRows.length - 1].__ts;
      }
    }

    if (bestWindow >= threshold) {
      result.push({
        entity,
        txCount: bestWindow,
        approved: approvedInBest,
        declined: declinedInBest,
        approvalRatio: pct(approvedInBest, bestWindow),
        firstSeen: formatLocal(bestStart),
        lastSeen: formatLocal(bestEnd)
      });
    }
  });

  return result.sort((a, b) => b.txCount - a.txCount).slice(0, 100);
}

function categorizeDecline(reason: string): string {
  if (!reason) return "Approved / Not declined";
  if (FRAUD_RE.test(reason)) return "Fraud / Risk";
  if (AUTH_RE.test(reason)) return "Authentication / 3DS / CVV";
  if (FUNDS_RE.test(reason)) return "Insufficient funds";
  if (ISSUER_RE.test(reason)) return "Issuer / Authorization";
  if (CUSTOMER_RE.test(reason)) return "Customer / Session / Expired";
  return "Other decline";
}

function formatLocal(ts: number) {
  if (!ts) return "";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function buildRetryKey(r: Row) {
  if (normalize(r.merchantOrderId)) return `merchantOrderId:${normalize(r.merchantOrderId)}`;
  if (normalize(r.transactionId)) return `transactionId:${normalize(r.transactionId)}`;
  return `fallback:${keyOf(r.email, r.amount, r.currency, r.pspName)}`;
}

function buildEntitySummaries(rows: Row[], settings: Settings) {
  const byEntity = groupCount(rows, (r) => normalize(r.email) || normalize(r.ipAddress) || keyOf(r.bin, r.lastFourDigits));
  const output: any[] = [];

  byEntity.forEach((items, entity) => {
    if (!entity) return;
    const tx = items.length;
    const approved = items.filter((r) => r.statusNorm === "approved").length;
    const declined = tx - approved;
    const declineRatio = tx ? declined / tx : 0;
    const fraudDeclines = items.filter((r) => FRAUD_RE.test(r.declineReasonNorm)).length;
    const authDeclines = items.filter((r) => AUTH_RE.test(r.declineReasonNorm)).length;
    const smallAmountAttempts = items.filter((r) => r.amountNum > 0 && r.amountNum <= 10).length;
    const uniqueCards = new Set(items.map((r) => keyOf(r.bin, r.lastFourDigits)).filter(Boolean)).size;
    const uniqueIps = new Set(items.map((r) => normalize(r.ipAddress)).filter(Boolean)).size;
    const uniqueCountries = new Set(items.map((r) => normalize(r.country)).filter(Boolean)).size;

    const best5m = summarizeVelocity(items, (r) => entity, 5, 1)[0]?.txCount ?? 0;
    const best15m = summarizeVelocity(items, (r) => entity, 15, 1)[0]?.txCount ?? 0;

    let riskScore = 0;
    const reasons: string[] = [];

    if (best5m >= settings.highVelocity5m) {
      riskScore += 3;
      reasons.push(`High 5m velocity (${best5m})`);
    }
    if (best15m >= settings.highVelocity15m) {
      riskScore += 2;
      reasons.push(`High 15m velocity (${best15m})`);
    }
    if (declineRatio >= 0.8 && tx >= 5) {
      riskScore += 3;
      reasons.push(`Very high decline ratio (${(declineRatio * 100).toFixed(0)}%)`);
    }
    if (fraudDeclines >= 1) {
      riskScore += 3;
      reasons.push(`Fraud/risk decline hits (${fraudDeclines})`);
    }
    if (authDeclines >= 3) {
      riskScore += 1;
      reasons.push(`Repeated auth/3DS issues (${authDeclines})`);
    }
    if (smallAmountAttempts >= 4 && declineRatio >= 0.7) {
      riskScore += 2;
      reasons.push(`Possible card testing pattern (${smallAmountAttempts} small attempts)`);
    }
    if (uniqueCards >= 3) {
      riskScore += 2;
      reasons.push(`Multiple card fingerprints (${uniqueCards})`);
    }
    if (uniqueIps >= 2 && tx >= 5) {
      riskScore += 1;
      reasons.push(`Multiple IPs (${uniqueIps})`);
    }
    if (uniqueCountries >= 2 && tx >= 4) {
      riskScore += 1;
      reasons.push(`Cross-country attempts (${uniqueCountries})`);
    }

    const riskBand = riskScore >= 7 ? "High" : riskScore >= 4 ? "Medium" : "Low";

    if (riskScore >= 4) {
      output.push({
        entity,
        tx,
        approved,
        declined,
        approvalRatio: pct(approved, tx),
        fraudDeclines,
        authDeclines,
        uniqueCards,
        uniqueIps,
        riskScore,
        riskBand,
        keyDrivers: reasons.join("; ")
      });
    }
  });

  return output.sort((a, b) => b.riskScore - a.riskScore || b.tx - a.tx).slice(0, 100);
}

function buildRetrySummary(rows: Row[], settings: Settings) {
  const byRetry = groupCount(rows, buildRetryKey);
  const summary: any[] = [];
  const recovered: any[] = [];
  const flaggedTx: any[] = [];

  byRetry.forEach((items, retryKey) => {
    const sorted = [...items].sort((a, b) => a.__ts - b.__ts);
    if (sorted.length <= 1) return;

    const attempts = sorted.length;
    const firstTs = sorted[0].__ts;
    const lastTs = sorted[sorted.length - 1].__ts;
    const durationMinutes = Math.max(1, Math.round((lastTs - firstTs) / 60000));
    const approved = sorted.filter((r) => r.statusNorm === "approved").length;
    const declined = attempts - approved;
    const recoveredOnRetry = approved >= 1 && declined >= 1;
    const withinRetryWindow = lastTs - firstTs <= settings.retryWindowMinutes * 60 * 1000;
    const entity = normalize(sorted[0].email) || normalize(sorted[0].ipAddress) || keyOf(sorted[0].bin, sorted[0].lastFourDigits);

    summary.push({
      retryKey,
      entity,
      pspName: normalize(sorted[0].pspName),
      amount: sorted[0].amountNum,
      currency: normalize(sorted[0].currency),
      attempts,
      approved,
      declined,
      recoveredOnRetry: recoveredOnRetry ? "Yes" : "No",
      withinRetryWindow: withinRetryWindow ? "Yes" : "No",
      firstSeen: formatLocal(firstTs),
      lastSeen: formatLocal(lastTs)
    });

    if (recoveredOnRetry) {
      recovered.push({
        retryKey,
        entity,
        pspName: normalize(sorted[0].pspName),
        attempts,
        firstDeclineReason: normalize(sorted.find((r) => r.statusNorm === "declined")?.declineReason),
        amount: sorted[0].amountNum,
        currency: normalize(sorted[0].currency),
        recoveredAt: formatLocal(sorted.find((r) => r.statusNorm === "approved")?.__ts || lastTs)
      });
    }

    if (attempts >= 3 || (declined >= 3 && approved === 0)) {
      sorted.forEach((r) => {
        flaggedTx.push({
          processingDate: formatLocal(r.__ts),
          pspName: normalize(r.pspName),
          email: normalize(r.email),
          ipAddress: normalize(r.ipAddress),
          merchantOrderId: normalize(r.merchantOrderId),
          transactionId: normalize(r.transactionId),
          amount: r.amountNum,
          currency: normalize(r.currency),
          status: normalize(r.status),
          declineReason: normalize(r.declineReason),
          retryKey,
          retryAttemptsForKey: attempts
        });
      });
    }
  });

  return {
    summary: summary.sort((a, b) => b.attempts - a.attempts).slice(0, 200),
    recovered: recovered.sort((a, b) => b.attempts - a.attempts).slice(0, 100),
    flaggedTx
  };
}

export function analyze(rawRows: Row[], settings: Settings): AnalysisResult {
  const prepared = rawRows.map((r) => ({
    ...r,
    pspNameNorm: normalize(r.pspName).toLowerCase(),
    paymentMethodNorm: normalize(r.paymentMethod).toLowerCase(),
    statusNorm: normalize(r.status).toLowerCase(),
    declineReasonNorm: normalize(r.declineReason),
    amountNum: toNumber(r.amount),
    __ts: parseDate(r.processing_date || r.processingDate, settings.timezoneOffset)
  }));

  const filtered = prepared.filter((r) =>
    r.paymentMethodNorm === "credit_card" &&
    !settings.excludePsps.map((p) => p.toLowerCase()).includes(r.pspNameNorm)
  );

  const approved = filtered.filter((r) => r.statusNorm === "approved").length;
  const declined = filtered.length - approved;

  const topPsps = Object.entries(
    filtered.reduce((acc: Record<string, number>, r) => {
      const key = normalize(r.pspName) || "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([pspName, txCount]) => ({
      pspName,
      txCount,
      approved: filtered.filter((r) => normalize(r.pspName) === pspName && r.statusNorm === "approved").length,
      declined: filtered.filter((r) => normalize(r.pspName) === pspName && r.statusNorm === "declined").length
    }))
    .map((r) => ({ ...r, approvalRatio: pct(r.approved, r.txCount) }))
    .sort((a, b) => b.txCount - a.txCount);

  const topCountries = Object.entries(
    filtered.reduce((acc: Record<string, number>, r) => {
      const key = normalize(r.country) || "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([country, txCount]) => ({
      country,
      txCount,
      approved: filtered.filter((r) => normalize(r.country) === country && r.statusNorm === "approved").length,
      declined: filtered.filter((r) => normalize(r.country) === country && r.statusNorm === "declined").length
    }))
    .map((r) => ({ ...r, approvalRatio: pct(r.approved, r.txCount) }))
    .sort((a, b) => b.txCount - a.txCount)
    .slice(0, 30);

  const declinedRows = filtered.filter((r) => r.statusNorm === "declined");
  const declineReasons = Object.entries(
    declinedRows.reduce((acc: Record<string, number>, r) => {
      const key = normalize(r.declineReason) || "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([declineReason, txCount]) => ({ declineReason, txCount }))
    .sort((a, b) => b.txCount - a.txCount)
    .slice(0, 30);

  const declineCategories = Object.entries(
    declinedRows.reduce((acc: Record<string, number>, r) => {
      const key = categorizeDecline(normalize(r.declineReason));
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([category, txCount]) => ({ category, txCount }))
    .sort((a, b) => b.txCount - a.txCount);

  const velocity5m = summarizeVelocity(filtered, (r) => normalize(r.email) || normalize(r.ipAddress) || keyOf(r.bin, r.lastFourDigits), 5, settings.highVelocity5m);
  const velocity15m = summarizeVelocity(filtered, (r) => normalize(r.email) || normalize(r.ipAddress) || keyOf(r.bin, r.lastFourDigits), 15, settings.highVelocity15m);
  const velocity60m = summarizeVelocity(filtered, (r) => normalize(r.email) || normalize(r.ipAddress) || keyOf(r.bin, r.lastFourDigits), 60, settings.highVelocity60m);

  const highRiskEntities = buildEntitySummaries(filtered, settings);
  const retry = buildRetrySummary(filtered, settings);
  const retryObjects = retry.summary;
  const recoveredRetries = retry.recovered;
  const flaggedTransactions = retry.flaggedTx.slice(0, 1000);

  const retryRate = retryObjects.length
    ? pct(retryObjects.reduce((sum, r) => sum + r.attempts, 0) - retryObjects.length, filtered.length)
    : "0.00%";

  const kpis: Kpi[] = [
    { label: "International card tx", value: filtered.length.toLocaleString(), note: "Credit card only, excluding Confirmo and PayPal by default" },
    { label: "Approval ratio", value: pct(approved, filtered.length), note: `${approved.toLocaleString()} approved / ${declined.toLocaleString()} declined` },
    { label: "Retry pressure", value: retryRate, note: `${retryObjects.length.toLocaleString()} retry groups detected` },
    { label: "High-risk entities", value: highRiskEntities.length.toLocaleString(), note: "Email / IP / card fingerprint with medium or high risk score" }
  ];

  return {
    filteredCount: filtered.length,
    totalCount: rawRows.length,
    kpis,
    topPsps,
    topCountries,
    declineReasons,
    declineCategories,
    highRiskEntities,
    velocity5m,
    velocity15m,
    velocity60m,
    retrySummary: retryObjects,
    recoveredRetries,
    flaggedTransactions
  };
}
