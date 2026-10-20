import { useEffect, useRef, useState } from "react";
import { CURRENCY, formatMonth, money } from "./lib/finance.js";
import { buildMerchantReport, merchantReturnHref } from "./lib/merchantReports.js";

const dateLabel = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
const weekLabel = (week) => `${dateLabel(week.start)} – ${dateLabel(week.end)}`;

export default function MerchantReport({ ledger, route, month, renderTransactions }) {
  const key = route.params.get("merchant");
  const basis = route.params.get("basis") || "purchase";
  const report = buildMerchantReport(ledger, key, { month, basis });
  const mode = ["month", "weekly"].includes(route.params.get("report")) ? route.params.get("report") : "monthly";
  const [limit, setLimit] = useState(30);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [key]);
  useEffect(() => { setLimit(30); }, [key, mode, month, basis, route.params.get("week")]);
  const back = merchantReturnHref(route.params.get("from"));
  function href(changes) {
    const params = new URLSearchParams(route.params);
    params.set("month", month);
    for (const [name, value] of Object.entries(changes)) value == null ? params.delete(name) : params.set(name, value);
    return `#merchant?${params}`;
  }
  if (!report) return <section className="view active merchant-report"><a className="text-link" href={back}>← Back to report</a><header className="screen-header"><div><h1 ref={heading} tabIndex={-1}>Merchant not found</h1><p>This merchant is unavailable in the current ledger. Open a merchant from Activity.</p></div></header><a className="secondary-btn" href="#activity">Open Activity</a></section>;
  const week = report.weeks.find((item) => item.start === route.params.get("week")) || report.weeks.find((item) => item.start === report.defaultWeek);
  const rows = report.rows.filter((tx) => mode === "monthly" || (mode === "month" ? tx.date.startsWith(`${month}-`) : tx.date >= week.start && tx.date <= week.end));
  const summary = mode === "monthly" ? report.allTime : mode === "month" ? report.selected : week;
  const period = mode === "monthly" ? report.basis === "installments" ? "All budget allocations" : "All imported history" : mode === "month" ? formatMonth(month) : `${weekLabel(week)}, ${week.start.slice(0, 4)}`;
  const basisLabel = report.basis === "billing" ? "Billed transactions" : report.basis === "installments" ? "Installment allocations" : "Purchases";
  const chartRows = mode === "monthly" ? [...report.monthly].reverse() : report.weeks;
  const scale = Math.max(1, ...chartRows.map((item) => Math.abs(item.net)));
  const change = mode === "month" ? report.monthChange : mode === "weekly" ? week.change : null;
  const returnView = back.slice(1).split("?")[0];
  const backLabel = { today: "Today", activity: "Activity", budget: "Budget", commitments: "Commitments", income: "Income" }[returnView] || "report";
  return <section className="view active merchant-report" data-screen="merchant">
    <a className="text-link merchant-back" href={back}>← Back to {backLabel}</a>
    <header className="screen-header"><div><span className="merchant-eyebrow">Merchant report</span><h1 ref={heading} tabIndex={-1} dir="auto">{report.name}</h1><p>{report.description}</p></div><div className="screen-header-controls">
      <label className="month-select screen-month"><select aria-label="Merchant report period" value={mode === "monthly" ? "all" : month} onChange={(event) => { window.location.hash = href(event.target.value === "all" ? { report: "monthly", week: null } : { month: event.target.value, report: mode === "weekly" ? "weekly" : "month", week: null }); }}><option value="all">All time</option>{report.months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</select></label>
    </div></header>
    <div className="merchant-basis-row"><div className="date-basis-toggle" role="group" aria-label="Merchant date basis">{[["purchase", "Purchases"], ["installments", "Installment allocations"], ["billing", "Billed transactions"]].map(([value, label]) => <a className={report.basis === value ? "active" : ""} aria-current={report.basis === value ? "true" : undefined} key={value} href={href({ basis: value })}>{label}</a>)}</div><p className="soft-copy">{report.basis === "purchase" ? "Full purchases counted once, on their purchase date." : report.basis === "installments" ? "Purchases spread into monthly budget portions; estimates are labeled." : "Imported charges on their billing date; bank items on their posted date."}</p></div>
    <nav className="budget-report-tabs" aria-label="Merchant report view">{[["monthly", "By month"], ["month", "Selected month"], ["weekly", "Week over week"]].map(([value, label]) => <a className={`budget-report-tab ${mode === value ? "active" : ""}`} aria-current={mode === value ? "page" : undefined} key={value} href={href({ report: value, week: null })}>{label}</a>)}</nav>
    <div className="merchant-period"><h2>{period}</h2>{summary.status && <span className="merchant-period-status">{summary.status}</span>}<span className="soft-copy">{basisLabel} · Recorded through {dateLabel(report.through)}, {report.through.slice(0, 4)}</span></div>
    <section className="merchant-metrics" aria-label={`${period} summary`}>
      <article><span>Net spending</span><strong>{money(summary.net)}</strong><small>{money(summary.spent)} before refunds</small></article>
      <article><span>Refunds</span><strong>{money(summary.refunds)}</strong><small>Credits reduce net spending</small></article>
      <article><span>{report.basis === "purchase" ? "Purchases" : "Charges / portions"}</span><strong>{summary.purchaseCount}</strong><small>{summary.count} records including refunds</small></article>
      <article><span>{report.basis === "purchase" ? "Average purchase" : "Average charge / portion"}</span><strong>{summary.purchaseCount ? money(summary.average) : "—"}</strong><small>Before refunds</small></article>
    </section>
    {change != null && <p className="merchant-comparison">{change === 0 ? "No change" : `${money(Math.abs(change))} ${change > 0 ? "more" : "less"}`} than the previous {mode === "weekly" ? "week" : "month"} in net spending.{mode === "weekly" && week.changePercent != null && week.changePercent !== 0 ? ` (${Math.abs(week.changePercent).toFixed(0)}% ${week.changePercent > 0 ? "higher" : "lower"})` : ""}</p>}
    <section className="panel merchant-trend" aria-labelledby="merchantTrendTitle"><div className="panel-head"><div><h2 id="merchantTrendTitle">{mode === "monthly" ? "Monthly spending" : "Weekly spending"}</h2><p className="soft-copy">{mode === "monthly" ? "Select a month to review its transactions. Bars show net spending." : "Monday–Sunday, including days across month boundaries. Select a week to review it."}</p></div></div>
      <div className="merchant-chart">{chartRows.map((item) => {
        const label = item.month ? formatMonth(item.month) : weekLabel(item);
        const selected = mode === "weekly" && item.start === week.start;
        return <a key={item.month || item.start} className={`merchant-chart-row ${selected ? "selected" : ""}`} aria-current={selected ? "true" : undefined} href={href(item.month ? { month: item.month, report: "month", week: null } : { report: "weekly", week: item.start })} aria-label={`${label}: ${money(item.net)} net spending, ${item.count} records${item.status ? `, ${item.status}` : ""}`}>
          <span className="merchant-chart-label"><strong>{label}</strong><small>{item.status || (item.count ? `${item.count} records` : "No recorded spending")}</small></span><span className="merchant-chart-track" aria-hidden="true"><i className={item.net < 0 ? "credit" : ""} style={{ width: `${Math.max(item.net ? 1 : 0, Math.abs(item.net) / scale * 100)}%` }} /></span><span className="merchant-chart-value"><strong>{money(item.net)}</strong>{item.change != null && <small>{item.change === 0 ? "Unchanged" : `${item.change > 0 ? "+" : "−"}${money(Math.abs(item.change))}`} vs prior week</small>}</span>
        </a>;
      })}</div>
      <p className="table-note">All amounts in {CURRENCY}. Partial periods are not compared with complete periods.{report.estimatedCount > 0 ? " Installment allocations include estimated portions." : ""}</p>
    </section>
    <section className="panel activity-transactions"><div className="panel-head"><div><h2>{mode === "monthly" ? "All transactions" : "Transactions for this period"}</h2><p className="soft-copy">{period} · {basisLabel.toLowerCase()}</p></div>{mode !== "monthly" && <a className="text-link" href={href({ report: "monthly", week: null })}>All time</a>}</div>
      {rows.length ? renderTransactions(rows.slice(0, limit)) : <p className="soft-copy activity-empty">No recorded transactions for this period. <a href={href({ report: "monthly", week: null })}>View all history</a></p>}
      {rows.length > limit && <div className="merchant-more"><span className="soft-copy">Showing {limit} of {rows.length} records</span><button className="secondary-btn" onClick={() => setLimit(limit + 50)}>Show more transactions</button></div>}
    </section>
  </section>;
}
