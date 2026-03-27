"use client";

import Papa from "papaparse";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line
} from "recharts";
import { AnalysisResult, analyze, Settings } from "@/lib/analyze";

const defaultSettings: Settings = {
  excludePsps: ["Confirmo", "PayPal"],
  timezoneOffset: 6,
  retryWindowMinutes: 30,
  highVelocity5m: 5,
  highVelocity15m: 8,
  highVelocity60m: 15
};

function downloadCsv(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DataTable({
  title,
  caption,
  rows,
  exportName
}: {
  title: string;
  caption?: string;
  rows: Record<string, any>[];
  exportName?: string;
}) {
  const keys = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2 className="section-title">{title}</h2>
          {caption ? <p className="caption">{caption}</p> : null}
        </div>
        {exportName && rows.length ? (
          <button className="btn" onClick={() => downloadCsv(rows, exportName)}>
            Export CSV
          </button>
        ) : null}
      </div>
      {!rows.length ? (
        <div className="empty">No rows found for this section.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {keys.map((key) => {
                    const value = row[key];
                    const riskClass =
                      key.toLowerCase().includes("riskband") || key.toLowerCase().includes("finalstatus")
                        ? value === "High" || value === "Declined"
                          ? "risk-high"
                          : value === "Medium"
                            ? "risk-medium"
                            : "risk-low"
                        : "";
                    return (
                      <td key={key} className={riskClass}>
                        {String(value ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChartCard({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="section-title">{title}</h2>
      {caption ? <p className="caption">{caption}</p> : null}
      <div className="chart-box">{children}</div>
    </section>
  );
}

export default function Page() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [fileName, setFileName] = useState("");
  const [parseMessage, setParseMessage] = useState("Upload a BridgerPay CSV report to start the analysis.");

  const result: AnalysisResult | null = useMemo(() => {
    if (!rows.length) return null;
    return analyze(rows, settings);
  }, [rows, settings]);

  return (
    <main className="container">
      <div className="header">
        <div>
          <h1 className="title">BridgerPay International Card Velocity Tool — v2</h1>
          <p className="subtitle">
            Deduplicated by unique merchant ID, retry-aware, chart-based, and built for international card analysis.
            The tool treats one merchantOrderId as one transaction even if it declines across multiple PSPs and later
            approves in another PSP.
          </p>
          <div className="hero-tags">
            <span className="tag">Dedup by merchantOrderId</span>
            <span className="tag">Retry funnel</span>
            <span className="tag">Fraud behavior</span>
            <span className="tag">Decline analysis</span>
            <span className="tag">Vercel-ready</span>
          </div>
        </div>
        <div className="panel status-card">
          <div className="small muted">Loaded file</div>
          <div className="status-file">{fileName || "No file uploaded yet"}</div>
          <div className="small muted" style={{ marginTop: 8 }}>{parseMessage}</div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Upload + settings</h2>
        <p className="caption">
          Default logic: include only <strong>credit_card</strong> transactions and exclude <strong>Confirmo</strong> and
          <strong> PayPal</strong>. Deduplication is based on <strong>merchantOrderId</strong>, with fallback logic if missing.
        </p>

        <div className="controls">
          <div>
            <label>BridgerPay CSV</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                Papa.parse(file, {
                  header: true,
                  skipEmptyLines: true,
                  complete: (results) => {
                    setRows((results.data as Record<string, any>[]).filter((r) => Object.keys(r).length));
                    setParseMessage(`Parsed ${(results.data as any[]).length.toLocaleString()} raw rows from the file.`);
                  },
                  error: (error) => {
                    setRows([]);
                    setParseMessage(`CSV parsing failed: ${error.message}`);
                  }
                });
              }}
            />
          </div>

          <div>
            <label>Exclude PSPs</label>
            <input
              value={settings.excludePsps.join(", ")}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  excludePsps: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                }))
              }
            />
          </div>

          <div>
            <label>Timezone offset</label>
            <input
              type="number"
              value={settings.timezoneOffset}
              onChange={(e) => setSettings((prev) => ({ ...prev, timezoneOffset: Number(e.target.value || 0) }))}
            />
          </div>

          <div>
            <label>Retry window (minutes)</label>
            <input
              type="number"
              value={settings.retryWindowMinutes}
              onChange={(e) => setSettings((prev) => ({ ...prev, retryWindowMinutes: Number(e.target.value || 30) }))}
            />
          </div>

          <div>
            <label>High velocity in 5m</label>
            <input
              type="number"
              value={settings.highVelocity5m}
              onChange={(e) => setSettings((prev) => ({ ...prev, highVelocity5m: Number(e.target.value || 5) }))}
            />
          </div>

          <div>
            <label>High velocity in 15m</label>
            <input
              type="number"
              value={settings.highVelocity15m}
              onChange={(e) => setSettings((prev) => ({ ...prev, highVelocity15m: Number(e.target.value || 8) }))}
            />
          </div>

          <div>
            <label>High velocity in 60m</label>
            <input
              type="number"
              value={settings.highVelocity60m}
              onChange={(e) => setSettings((prev) => ({ ...prev, highVelocity60m: Number(e.target.value || 15) }))}
            />
          </div>
        </div>
      </section>

      {result ? (
        <>
          <section className="grid grid-6" style={{ marginBottom: 16 }}>
            {result.kpis.map((kpi) => (
              <div className="kpi" key={kpi.label}>
                <div className="kpi-label">{kpi.label}</div>
                <div className="kpi-value">{kpi.value}</div>
                {kpi.note ? <div className="kpi-note">{kpi.note}</div> : null}
              </div>
            ))}
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <ChartCard
              title="Overview"
              caption="Compares raw attempts with deduplicated merchant-level outcomes."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.overviewChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="metric" angle={-15} textAnchor="end" height={70} interval={0} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Retry bucket distribution"
              caption="Shows how many unique merchant IDs needed 1 attempt, 2 attempts, 3–4 attempts, or 5+ attempts."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.retryBuckets}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="merchantIds" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <ChartCard
              title="Decline category analysis"
              caption="Raw decline attempts grouped into meaningful operational categories."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.declineCategories} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="category" type="category" width={180} />
                  <Tooltip />
                  <Bar dataKey="txCount" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Hourly attempt trend"
              caption="Uses the selected timezone offset for operational monitoring and shift analysis."
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.hourlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" hide />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="attempts" dot={false} />
                  <Line type="monotone" dataKey="approved" dot={false} />
                  <Line type="monotone" dataKey="declined" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="PSP outcome analysis"
              caption="Deduplicated by final outcome per merchant ID. A merchant ID that declined across 4 PSPs and approved in 1 PSP counts once."
              rows={result.topPsps.slice(0, 20)}
              exportName="psp_outcome_analysis.csv"
            />
            <DataTable
              title="Country outcome analysis"
              caption="Country-level view using unique merchant IDs instead of raw attempts."
              rows={result.topCountries}
              exportName="country_outcome_analysis.csv"
            />
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="Fraud / risk patterns"
              caption="Merchant-level patterns that suggest card testing, attack traffic, excessive cross-PSP retries, or severe routing friction."
              rows={result.fraudPatterns}
              exportName="fraud_patterns.csv"
            />
            <DataTable
              title="High-risk entities"
              caption="Email / IP / card-fingerprint clusters ranked by behavior-based risk score."
              rows={result.highRiskEntities}
              exportName="high_risk_entities.csv"
            />
          </section>

          <section className="grid grid-3" style={{ marginBottom: 16 }}>
            <DataTable
              title="Velocity spikes — 5 minutes"
              caption="Top entities crossing the 5-minute threshold."
              rows={result.velocity5m}
            />
            <DataTable
              title="Velocity spikes — 15 minutes"
              caption="Useful for short fraud bursts and aggressive retry loops."
              rows={result.velocity15m}
            />
            <DataTable
              title="Velocity spikes — 60 minutes"
              caption="Useful for longer attack sessions and sustained transaction pressure."
              rows={result.velocity60m}
            />
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="Retry summary"
              caption="One row per retried merchant ID."
              rows={result.retrySummary}
              exportName="retry_summary.csv"
            />
            <DataTable
              title="Recovered retries"
              caption="Merchant IDs that were declined first and then later approved."
              rows={result.recoveredRetries}
              exportName="recovered_retries.csv"
            />
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="Top raw decline reasons"
              caption="Raw decline messages from the orchestrator report."
              rows={result.declineReasons}
              exportName="decline_reasons.csv"
            />
            <DataTable
              title="Deduplicated merchant outcomes"
              caption="Final merchant-level output after collapsing all retries and all PSP hops into a single outcome."
              rows={result.dedupTransactions.slice(0, 100)}
              exportName="dedup_merchant_outcomes.csv"
            />
          </section>

          <DataTable
            title="Flagged raw transactions"
            caption="Raw transaction rows belonging to flagged merchant IDs. Useful for investigations and PSP escalation."
            rows={result.flaggedTransactions}
            exportName="flagged_transactions.csv"
          />
        </>
      ) : null}
    </main>
  );
}
