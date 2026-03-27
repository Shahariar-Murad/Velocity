
"use client";

import Papa from "papaparse";
import { useMemo, useState } from "react";
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
  rows
}: {
  title: string;
  caption?: string;
  rows: Record<string, any>[];
}) {
  const keys = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <section className="panel">
      <h2 className="section-title">{title}</h2>
      {caption ? <p className="caption">{caption}</p> : null}
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
                      key.toLowerCase().includes("riskband")
                        ? value === "High"
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
          <h1 className="title">BridgerPay International Card Velocity Tool</h1>
          <p className="subtitle">
            Upload your BridgerPay orchestrator CSV. This tool automatically focuses on international card traffic by
            excluding Confirmo and PayPal by default, then shows velocity spikes, retry behavior, fraudulent activity
            patterns, risk scoring, and decline analysis.
          </p>
          <div className="hero-tags">
            <span className="tag">International card filter</span>
            <span className="tag">Retry-aware analysis</span>
            <span className="tag">Fraud / risk signals</span>
            <span className="tag">Decline root-cause analysis</span>
            <span className="tag">GMT+6 ready</span>
          </div>
        </div>
        <div className="panel" style={{ minWidth: 260 }}>
          <div className="small muted">Loaded file</div>
          <div style={{ marginTop: 8, fontWeight: 700 }}>{fileName || "No file uploaded yet"}</div>
          <div className="small muted" style={{ marginTop: 8 }}>{parseMessage}</div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Upload + settings</h2>
        <p className="caption">
          Default logic: include only <strong>credit_card</strong> transactions and exclude <strong>Confirmo</strong> and{" "}
          <strong>PayPal</strong>.
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
                  excludePsps: e.target.value.split(",").map((v) => v.trim()).filter(Boolean)
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
          <section className="grid grid-4" style={{ marginBottom: 16 }}>
            {result.kpis.map((kpi) => (
              <div className="kpi" key={kpi.label}>
                <div className="kpi-label">{kpi.label}</div>
                <div className="kpi-value">{kpi.value}</div>
                {kpi.note ? <div className="kpi-note">{kpi.note}</div> : null}
              </div>
            ))}
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="PSP analysis"
              caption="Transaction mix, volume and approval ratio across international card PSPs."
              rows={result.topPsps.slice(0, 20)}
            />
            <DataTable
              title="Country analysis"
              caption="Highest-volume countries after applying the international card filter."
              rows={result.topCountries}
            />
          </section>

          <section className="grid grid-3" style={{ marginBottom: 16 }}>
            <DataTable
              title="Velocity spikes — 5 minutes"
              caption="Top entities crossing the 5-minute threshold. Entity is email, IP, or card fingerprint fallback."
              rows={result.velocity5m}
            />
            <DataTable
              title="Velocity spikes — 15 minutes"
              caption="Useful for spotting short fraud bursts and aggressive retry loops."
              rows={result.velocity15m}
            />
            <DataTable
              title="Velocity spikes — 60 minutes"
              caption="Useful for detecting longer attack sessions and sustained transaction pressure."
              rows={result.velocity60m}
            />
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="High-risk entities"
              caption="Risk score is based on velocity, decline ratio, fraud-related declines, small-amount patterns, and multi-card or multi-IP behavior."
              rows={result.highRiskEntities}
            />
            <DataTable
              title="Retry summary"
              caption="A retry group is mainly identified by merchantOrderId. This section shows repeated attempts and whether an approval was eventually recovered."
              rows={result.retrySummary.slice(0, 100)}
            />
          </section>

          <section className="grid grid-2" style={{ marginBottom: 16 }}>
            <DataTable
              title="Recovered retries"
              caption="These are retry groups where at least one decline later turned into an approval."
              rows={result.recoveredRetries}
            />
            <DataTable
              title="Decline category analysis"
              caption="Declines are bucketed into root-cause groups so your team can quickly see whether the issue is fraud, issuer, authentication, or user-side."
              rows={result.declineCategories}
            />
          </section>

          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="flex" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h2 className="section-title">Detailed decline reasons</h2>
                <p className="caption">Top raw decline reasons exactly as they appear in the report.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>declineReason</th>
                    <th>txCount</th>
                  </tr>
                </thead>
                <tbody>
                  {result.declineReasons.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.declineReason}</td>
                      <td>{row.txCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="flex" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <h2 className="section-title">Flagged transactions export</h2>
                <p className="caption">
                  Transactions from heavy retry loops are collected here so you can export them for review, chargeback
                  prep, or PSP escalation.
                </p>
              </div>
              <div className="flex">
                <button
                  className="secondary"
                  onClick={() => downloadCsv(result.flaggedTransactions, "flagged_transactions.csv")}
                >
                  Export flagged CSV
                </button>
              </div>
            </div>
            {!result.flaggedTransactions.length ? (
              <div className="empty">No flagged transactions found.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(result.flaggedTransactions[0]).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.flaggedTransactions.slice(0, 200).map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(result.flaggedTransactions[0]).map((k) => (
                          <td key={k}>{String(row[k] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div style={{ marginTop: 16 }} className="footer-note">
            Notes: This tool assumes your BridgerPay CSV contains fields such as <strong>processing_date</strong> or{" "}
            <strong>processingDate</strong>, <strong>pspName</strong>, <strong>paymentMethod</strong>,{" "}
            <strong>status</strong>, <strong>declineReason</strong>, <strong>merchantOrderId</strong>,{" "}
            <strong>email</strong>, <strong>ipAddress</strong>, <strong>bin</strong> and <strong>lastFourDigits</strong>.
            If your file structure changes later, update the parser logic in <strong>lib/analyze.ts</strong>.
          </div>
        </>
      ) : (
        <section className="panel">
          <div className="empty">
            Upload your BridgerPay CSV to see international card velocity, retries, fraud patterns, risk scoring, and
            decline analysis.
          </div>
        </section>
      )}
    </main>
  );
}
