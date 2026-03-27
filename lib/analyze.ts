export type Row = Record<string, any>;

export type Settings = {
  excludePsps: string[];
  timezoneOffset: number;
  retryWindowMinutes: number;
  highVelocity5m: number;
  highVelocity15m: number;
  highVelocity60m: number;
};

export type Kpi = {
  label: string;
  value: string;
  note?: string;
};

export type AnalysisResult = {
  filteredCount: number;
  totalCount: number;
  kpis: Kpi[];
  topPsps: Row[];
  topCountries: Row[];
  declineReasons: Row[];
  declineCategories: Row[];
  highRiskEntities: Row[];
  velocity5m: Row[];
  velocity15m: Row[];
  velocity60m: Row[];
  retrySummary: Row[];
  recoveredRetries: Row[];
  flaggedTransactions: Row[];
  dedupTransactions: Row[];
  fraudPatterns: Row[];
  retryBuckets: Row[];
  hourlyTrend: Row[];
  overviewChart: Row[];
};

const FRAUD_RE = /(fraud|risk|banned|blacklist|stolen|pickup card|lost card|restricted card|security|aml)/i;
const AUTH_RE = /(3ds|authentication|cvv|cvc|avs|secure|verification|sca)/i;
const FUNDS_RE = /(insufficient funds|not sufficient funds|low balance)/i;
const ISSUER_RE = /(do not honor|do not honour|issuer|authorization system|authorisation system|not permitted|transaction not permitted|declined by authorization|declined by authorisation)/i;
const CUSTOMER_RE = /(invalid card number|expired card|session expired|cancelled by the user|canceled by the user|transaction expired)/i;

function normalize(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function toNumber(value: any): number {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: any, timezoneOffset = 6): number {
  if (typeof value === "number" && Number.isFinite(value)) return value + timezoneOffset * 60 * 60 * 1000;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getTime() + timezoneOffset * 60 * 60 * 1000;
}

function keyOf(...parts: any[]): string {
  return parts.map(normalize).filter(Boolean).join("|");
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
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

function formatLocal(ts: number) {
  if (!ts) return "";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
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

function buildMerchantKey(r: Row): string {
  if (normalize(r.merchantOrderId)) return `merchantOrderId:${normalize(r.merchantOrderId)}`;
  if (normalize(r.transactionId)) return `transactionId:${normalize(r.transactionId)}`;
  return `fallback:${keyOf(r.email, r.amount, r.currency, r.processing_date || r.processingDate)}`;
}

function buildEntityKey(r: Row): string {
  return normalize(r.email) || normalize(r.ipAddress) || keyOf(r.bin, r.lastFourDigits) || normalize(r.merchantOrderId) || normalize(r.transactionId);
}

function summarizeVelocity(rows: Row[], entityKey: (r: Row) => string, minutes: number, threshold: number) {
  const byEntity = groupCount(rows, entityKey);
  const result: Row[] = [];

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
        declinedInBest = windowRows.filter((r) => r.statusNorm !== "approved").length;
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

  return result.sort((a, b) => Number(b.txCount) - Number(a.txCount)).slice(0, 100);
}

function buildEntitySummaries(rows: Row[], settings: Settings) {
  const byEntity = groupCount(rows, buildEntityKey);
  const output: Row[] = [];

  byEntity.forEach((items, entity) => {
    if (!entity) return;
    const tx = items.length;
    if (tx < 2) return;
    const approved = items.filter((r) => r.statusNorm === "approved").length;
    const declined = tx - approved;
    const declineRatio = tx ? declined / tx : 0;
    const fraudDeclines = items.filter((r) => FRAUD_RE.test(r.declineReasonNorm)).length;
    const authDeclines = items.filter((r) => AUTH_RE.test(r.declineReasonNorm)).length;
    const smallAmountAttempts = items.filter((r) => r.amountNum > 0 && r.amountNum <= 10).length;
    const uniqueCards = new Set(items.map((r) => keyOf(r.bin, r.lastFourDigits)).filter(Boolean)).size;
    const uniqueIps = new Set(items.map((r) => normalize(r.ipAddress)).filter(Boolean)).size;
    const uniquePsps = new Set(items.map((r) => normalize(r.pspName)).filter(Boolean)).size;

    const best5m = summarizeVelocity(items, () => entity, 5, 1)[0]?.txCount ?? 0;
    const best15m = summarizeVelocity(items, () => entity, 15, 1)[0]?.txCount ?? 0;

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
    if (declineRatio >= 0.8 && tx >= 4) {
      riskScore += 3;
      reasons.push(`Very high decline ratio (${(declineRatio * 100).toFixed(0)}%)`);
    }
    if (fraudDeclines >= 1) {
      riskScore += 3;
      reasons.push(`Fraud/risk declines (${fraudDeclines})`);
    }
    if (authDeclines >= 3) {
      riskScore += 1;
      reasons.push(`Repeated auth issues (${authDeclines})`);
    }
    if (smallAmountAttempts >= 4 && declineRatio >= 0.7) {
      riskScore += 2;
      reasons.push(`Possible card testing (${smallAmountAttempts} small attempts)`);
    }
    if (uniqueCards >= 3) {
      riskScore += 2;
      reasons.push(`Multiple cards (${uniqueCards})`);
    }
    if (uniqueIps >= 2 && tx >= 5) {
      riskScore += 1;
      reasons.push(`Multiple IPs (${uniqueIps})`);
    }
    if (uniquePsps >= 3) {
      riskScore += 2;
      reasons.push(`Cross-PSP retrying (${uniquePsps} PSPs)`);
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
        uniquePsps,
        riskScore,
        riskBand,
        keyDrivers: reasons.join("; ")
      });
    }
  });

  return output.sort((a, b) => Number(b.riskScore) - Number(a.riskScore) || Number(b.tx) - Number(a.tx)).slice(0, 100);
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

  const excluded = settings.excludePsps.map((p) => p.toLowerCase());
  const filtered = prepared.filter((r) => r.paymentMethodNorm === "credit_card" && !excluded.includes(r.pspNameNorm));

  const rawApproved = filtered.filter((r) => r.statusNorm === "approved").length;
  const rawDeclined = filtered.length - rawApproved;
  const declinedRows = filtered.filter((r) => r.statusNorm !== "approved");

  const merchantGroups = groupCount(filtered, buildMerchantKey);
  const dedupTransactions: Row[] = [];
  const retrySummary: Row[] = [];
  const recoveredRetries: Row[] = [];
  const fraudPatterns: Row[] = [];
  const flaggedTransactions: Row[] = [];
  const retryBucketCounter = {
    single: 0,
    two: 0,
    threeToFour: 0,
    fivePlus: 0
  };

  merchantGroups.forEach((items, merchantKey) => {
    const sorted = [...items].sort((a, b) => a.__ts - b.__ts);
    const approvedRows = sorted.filter((r) => r.statusNorm === "approved");
    const finalApproved = approvedRows.length > 0;
    const finalRow = finalApproved ? approvedRows[approvedRows.length - 1] : sorted[sorted.length - 1];
    const firstTs = sorted[0].__ts;
    const lastTs = sorted[sorted.length - 1].__ts;
    const attempts = sorted.length;
    const uniquePsps = new Set(sorted.map((r) => normalize(r.pspName)).filter(Boolean));
    const declineRows = sorted.filter((r) => r.statusNorm !== "approved");
    const declineCategories = new Set(declineRows.map((r) => categorizeDecline(normalize(r.declineReason))));
    const durationMinutes = Math.max(0, Math.round((lastTs - firstTs) / 60000));
    const firstDecline = declineRows[0];
    const finalStatus = finalApproved ? "Approved" : "Declined";
    const riskSignals: string[] = [];

    if (attempts === 1) retryBucketCounter.single += 1;
    else if (attempts === 2) retryBucketCounter.two += 1;
    else if (attempts <= 4) retryBucketCounter.threeToFour += 1;
    else retryBucketCounter.fivePlus += 1;

    dedupTransactions.push({
      merchantKey,
      merchantOrderId: normalize(finalRow.merchantOrderId),
      email: normalize(finalRow.email),
      country: normalize(finalRow.country),
      amount: finalRow.amountNum,
      currency: normalize(finalRow.currency),
      attempts,
      uniquePsps: uniquePsps.size,
      finalStatus,
      finalPsp: normalize(finalRow.pspName),
      firstSeen: formatLocal(firstTs),
      lastSeen: formatLocal(lastTs),
      durationMinutes,
      recoveredAfterRetry: attempts > 1 && finalApproved && declineRows.length > 0 ? "Yes" : "No",
      firstDeclineReason: normalize(firstDecline?.declineReason),
      lastDeclineCategory: declineRows.length ? categorizeDecline(normalize(declineRows[declineRows.length - 1].declineReason)) : ""
    });

    if (attempts > 1) {
      retrySummary.push({
        merchantKey,
        merchantOrderId: normalize(finalRow.merchantOrderId),
        email: normalize(finalRow.email),
        amount: finalRow.amountNum,
        currency: normalize(finalRow.currency),
        attempts,
        uniquePsps: uniquePsps.size,
        approvedAttempts: approvedRows.length,
        declinedAttempts: declineRows.length,
        finalStatus,
        finalPsp: normalize(finalRow.pspName),
        firstSeen: formatLocal(firstTs),
        lastSeen: formatLocal(lastTs),
        durationMinutes
      });
    }

    if (attempts > 1 && finalApproved && declineRows.length > 0) {
      recoveredRetries.push({
        merchantKey,
        merchantOrderId: normalize(finalRow.merchantOrderId),
        email: normalize(finalRow.email),
        attempts,
        uniquePsps: uniquePsps.size,
        firstDeclineReason: normalize(firstDecline?.declineReason),
        recoveredByPsp: normalize(finalRow.pspName),
        amount: finalRow.amountNum,
        currency: normalize(finalRow.currency),
        recoveredAt: formatLocal(finalRow.__ts)
      });
    }

    if (attempts >= 3 && uniquePsps.size >= 3 && !finalApproved) {
      riskSignals.push("Multi-PSP full decline");
    }
    if (attempts >= 4 && !finalApproved) {
      riskSignals.push("High retry no success");
    }
    if (attempts >= 3 && finalApproved && declineRows.length >= 2) {
      riskSignals.push("Late success after repeated declines");
    }
    if (declineRows.some((r) => FRAUD_RE.test(normalize(r.declineReason)))) {
      riskSignals.push("Fraud/risk decline present");
    }
    if (declineRows.length >= 3 && declineCategories.has("Authentication / 3DS / CVV")) {
      riskSignals.push("Repeated auth failure");
    }

    if (riskSignals.length) {
      fraudPatterns.push({
        merchantKey,
        merchantOrderId: normalize(finalRow.merchantOrderId),
        email: normalize(finalRow.email),
        country: normalize(finalRow.country),
        attempts,
        uniquePsps: uniquePsps.size,
        finalStatus,
        finalPsp: normalize(finalRow.pspName),
        riskPattern: riskSignals.join("; "),
        firstDeclineReason: normalize(firstDecline?.declineReason),
        amount: finalRow.amountNum,
        currency: normalize(finalRow.currency)
      });

      sorted.forEach((r) => {
        flaggedTransactions.push({
          processingDate: formatLocal(r.__ts),
          merchantKey,
          merchantOrderId: normalize(r.merchantOrderId),
          pspName: normalize(r.pspName),
          email: normalize(r.email),
          ipAddress: normalize(r.ipAddress),
          amount: r.amountNum,
          currency: normalize(r.currency),
          status: normalize(r.status),
          declineReason: normalize(r.declineReason),
          attemptsForMerchant: attempts,
          uniquePspsForMerchant: uniquePsps.size,
          finalMerchantStatus: finalStatus
        });
      });
    }
  });

  const dedupApproved = dedupTransactions.filter((r) => r.finalStatus === "Approved").length;
  const dedupDeclined = dedupTransactions.length - dedupApproved;

  const topPsps = Object.entries(
    dedupTransactions.reduce((acc: Record<string, Row>, r) => {
      const key = normalize(r.finalPsp) || "Unknown";
      if (!acc[key]) acc[key] = { pspName: key, uniqueMerchantIds: 0, approved: 0, declined: 0, savedOnRetry: 0, avgAttempts: 0 };
      acc[key].uniqueMerchantIds += 1;
      if (r.finalStatus === "Approved") acc[key].approved += 1;
      else acc[key].declined += 1;
      if (r.recoveredAfterRetry === "Yes") acc[key].savedOnRetry += 1;
      acc[key].avgAttempts += Number(r.attempts || 0);
      return acc;
    }, {})
  )
    .map(([, row]) => ({
      ...row,
      approvalRatio: pct(Number(row.approved), Number(row.uniqueMerchantIds)),
      avgAttempts: (Number(row.avgAttempts) / Math.max(1, Number(row.uniqueMerchantIds))).toFixed(2)
    }))
    .sort((a, b) => Number(b.uniqueMerchantIds) - Number(a.uniqueMerchantIds));

  const topCountries = Object.entries(
    dedupTransactions.reduce((acc: Record<string, Row>, r) => {
      const key = normalize(r.country) || "Unknown";
      if (!acc[key]) acc[key] = { country: key, uniqueMerchantIds: 0, approved: 0, declined: 0 };
      acc[key].uniqueMerchantIds += 1;
      if (r.finalStatus === "Approved") acc[key].approved += 1;
      else acc[key].declined += 1;
      return acc;
    }, {})
  )
    .map(([, row]) => ({ ...row, approvalRatio: pct(Number(row.approved), Number(row.uniqueMerchantIds)) }))
    .sort((a, b) => Number(b.uniqueMerchantIds) - Number(a.uniqueMerchantIds))
    .slice(0, 30);

  const declineReasons = Object.entries(
    declinedRows.reduce((acc: Record<string, number>, r) => {
      const key = normalize(r.declineReason) || "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([declineReason, txCount]) => ({ declineReason, txCount }))
    .sort((a, b) => Number(b.txCount) - Number(a.txCount))
    .slice(0, 30);

  const declineCategories = Object.entries(
    declinedRows.reduce((acc: Record<string, number>, r) => {
      const key = categorizeDecline(normalize(r.declineReason));
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([category, txCount]) => ({ category, txCount }))
    .sort((a, b) => Number(b.txCount) - Number(a.txCount));

  const velocity5m = summarizeVelocity(filtered, buildEntityKey, 5, settings.highVelocity5m);
  const velocity15m = summarizeVelocity(filtered, buildEntityKey, 15, settings.highVelocity15m);
  const velocity60m = summarizeVelocity(filtered, buildEntityKey, 60, settings.highVelocity60m);

  const highRiskEntities = buildEntitySummaries(filtered, settings);

  const retryBuckets = [
    { bucket: "1", merchantIds: retryBucketCounter.single },
    { bucket: "2", merchantIds: retryBucketCounter.two },
    { bucket: "3-4", merchantIds: retryBucketCounter.threeToFour },
    { bucket: "5+", merchantIds: retryBucketCounter.fivePlus }
  ];

  const hourlyTrend = Object.entries(
    filtered.reduce((acc: Record<string, Row>, r) => {
      const hour = formatLocal(r.__ts).slice(0, 13) + ":00";
      if (!acc[hour]) acc[hour] = { hour, attempts: 0, approved: 0, declined: 0 };
      acc[hour].attempts += 1;
      if (r.statusNorm === "approved") acc[hour].approved += 1;
      else acc[hour].declined += 1;
      return acc;
    }, {})
  )
    .map(([, row]) => row)
    .sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

  const overviewChart = [
    { metric: "Raw Attempts", value: filtered.length },
    { metric: "Unique Merchant IDs", value: dedupTransactions.length },
    { metric: "Raw Approved", value: rawApproved },
    { metric: "Dedup Approved", value: dedupApproved },
    { metric: "Recovered Retries", value: recoveredRetries.length },
    { metric: "Flagged Merchant IDs", value: fraudPatterns.length }
  ];

  const retryGroups = retrySummary.length;
  const retryExtraAttempts = Math.max(0, filtered.length - dedupTransactions.length);
  const recoveredRate = retryGroups ? pct(recoveredRetries.length, retryGroups) : "0.00%";
  const dedupApprovalRatio = pct(dedupApproved, dedupTransactions.length);

  const kpis: Kpi[] = [
    { label: "Raw card attempts", value: filtered.length.toLocaleString(), note: "Credit card only, excluding Confirmo and PayPal by default" },
    { label: "Unique merchant IDs", value: dedupTransactions.length.toLocaleString(), note: "Deduplicated by merchantOrderId with fallback logic" },
    { label: "Dedup approval ratio", value: dedupApprovalRatio, note: `${dedupApproved.toLocaleString()} approved / ${dedupDeclined.toLocaleString()} declined` },
    { label: "Recovered retries", value: recoveredRate, note: `${recoveredRetries.length.toLocaleString()} recovered merchant IDs out of ${retryGroups.toLocaleString()} retry groups` },
    { label: "Extra retry attempts", value: retryExtraAttempts.toLocaleString(), note: "Raw attempts minus unique merchant IDs" },
    { label: "Flagged merchant IDs", value: fraudPatterns.length.toLocaleString(), note: "Potential fraud, attack, or routing friction patterns" }
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
    retrySummary: retrySummary.sort((a, b) => Number(b.attempts) - Number(a.attempts)).slice(0, 200),
    recoveredRetries: recoveredRetries.sort((a, b) => Number(b.attempts) - Number(a.attempts)).slice(0, 100),
    flaggedTransactions: flaggedTransactions.slice(0, 1500),
    dedupTransactions: dedupTransactions.sort((a, b) => Number(b.attempts) - Number(a.attempts)).slice(0, 500),
    fraudPatterns: fraudPatterns.sort((a, b) => Number(b.attempts) - Number(a.attempts)).slice(0, 200),
    retryBuckets,
    hourlyTrend,
    overviewChart
  };
}
