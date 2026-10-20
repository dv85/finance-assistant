"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CURRENCY, formatMonth, money, monthShortDayFromDate } from "./lib/finance.js";
import { categoryReservations, localCalendarDate, validateAllowanceDraft } from "./lib/allowance.js";
import { saveBudgetPlan } from "./lib/dataSource.js";

const dailyMoney = value => new Intl.NumberFormat("en-IL", { style: "currency", currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.floor(value * 100) / 100);
const dateLabel = date => date ? monthShortDayFromDate(date) : "Date unavailable";

function CalculationRow({ label, value, detail, action, onClick, href, total = false }) {
  return <div className={`allowance-equation-row${total ? " is-total" : ""}`}><dt>{label}{detail && <small>{detail}</small>}{action && (href ? <a className="text-link" href={href}>{action}</a> : <button className="text-link" type="button" onClick={onClick}>{action}</button>)}</dt><dd>{value}</dd></div>;
}

export default function Today({ screen, month, onMonth, onPreview, onSharedState }) {
  const [setupStep, setSetupStep] = useState(null);
  const [message, setMessage] = useState("");
  const opener = useRef(null);
  const setupButton = useRef(null);
  const summary = screen.summary;
  const active = screen.isActiveMonth;
  const future = !active && month > localCalendarDate().slice(0, 7);
  const stale = active && (summary.latestBalanceAge > 3 || !summary.hasObservedBalance);
  const planHref = `#settings?panel=budgets&month=${month}`;
  const activityHref = `#activity?month=${month}&basis=billing`;
  const reason = summary.cashPool <= summary.budgetPool ? "Cash coverage" : "Your flexible budget";
  function open(step, event) { opener.current = event.currentTarget; setMessage(""); setSetupStep(step); }
  function close() { setSetupStep(null); requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : setupButton.current)?.focus()); }
  const description = !active
    ? future ? "Select the current month for a daily spending recommendation. This month shows your plan." : "This month has ended. Its totals are available below."
    : !summary.hasObservedBalance ? "A confirmed bank balance is missing. This estimate uses the opening balance; review your imported data before relying on it."
    : stale ? `Your bank balance is dated ${dateLabel(summary.balanceAsOf)}. Update your imported data before relying on this estimate.`
    : summary.safeSpendPool > 0 ? `${reason} sets this amount after reserving commitments and your comfort buffer.`
    : summary.cashPool <= 0 ? "Your cash does not cover remaining commitments and the protected buffer. No flexible allowance is available."
    : summary.flexibleGoal <= 0 ? "Set a flexible spending budget to calculate an allowance." : "Your flexible spending budget is used up. Review spending and your monthly plan.";

  return <section className="view active today-page" data-screen="today">
    <header className="screen-header today-page-heading"><div><h1>Today</h1><p>{active ? `As of ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())}` : `${formatMonth(month)} · ${future ? "Planned month" : "Month ended"}`}</p></div><label className="month-select"><select aria-label="Month selector" value={month} onChange={event => onMonth(event.target.value)}>{screen.availableMonths.map(value => <option key={value} value={value}>{formatMonth(value)}</option>)}</select></label></header>
    <section className="panel allowance-result" aria-labelledby="allowance-title">
      <div className="allowance-result-top"><div><h2 id="allowance-title">{active ? stale ? "Estimated daily spending" : "Suggested daily spending" : future ? "Monthly plan" : "Month summary"}</h2>{active && <><div className="allowance-amount">{dailyMoney(summary.safeDailySpend)} <span>/ day</span></div><p><strong>{summary.safeSpendPoolLabel}</strong> available through month-end · {summary.remainingDays} days including today</p></>}</div>{active ? <button ref={setupButton} className="primary-btn" type="button" onClick={event => open(0, event)}>Set up spending allowance</button> : <a className="secondary-btn" href={planHref}>Review month plan</a>}</div>
      <p className={stale || active && summary.safeSpendPool <= 0 ? "allowance-warning" : "soft-copy"}>{description}</p>
      {active && <small>A daily pace for the remaining days, recalculated from recorded spending. It is not a separate amount left to spend today. · {summary.hasObservedBalance ? `Bank balance dated ${dateLabel(summary.balanceAsOf)}` : "Opening balance fallback"}</small>}
    </section>
    {setupStep !== null && <AllowanceSetup screen={screen} month={month} initialStep={setupStep} onPreview={onPreview} onSharedState={onSharedState} onClose={close} onSaved={() => { setMessage("Monthly budget and comfort buffer saved. Your allowance and totals have been recalculated."); close(); }} />}
    <div hidden={setupStep !== null}>
      <section className="today-month-overview" aria-labelledby="today-month-title"><h2 id="today-month-title">{formatMonth(month).split(" ")[0]} at a glance</h2><div className="today-month-metrics">
        <article><span>Income for the month</span><strong>{summary.incomeThisMonthLabel}</strong><small>{active ? `${summary.upcomingIncomeLabel} upcoming cash income` : "Loaded monthly income"}</small><a className="text-link" href={`#income?month=${month}`}>Review income</a></article>
        <article><span>Spent this month</span><strong>{summary.spentThisMonthLabel}</strong><small>Recorded cash / billing expenses · {summary.spentIncomeRatio}</small><a className="text-link" href={activityHref}>Review spending</a></article>
        <article><span>{summary.totalCashBudgetRemaining < 0 ? "Over total budget" : "Total budget remaining"}</span><strong>{money(Math.abs(summary.totalCashBudgetRemaining))}</strong><small>Of {money(summary.totalBudgetGoal)} planned · Includes commitments</small><a className="text-link" href={`#budget?month=${month}`}>Review budget</a></article>
        <article><span>{active ? "Estimated closing balance" : future ? "Balance estimate unavailable" : "Closing balance"}</span><strong>{future || (!active && !summary.hasClosingBalance) ? "—" : summary.projectedEndBalanceLabel}</strong><small>{active ? "After using the available allowance" : future ? "Current-month forecast only" : summary.hasClosingBalance ? "From loaded monthly status" : "No month-end balance imported"}</small></article>
      </div></section>
      {active && <section className="today-calculation" aria-labelledby="today-calculation-title"><h2 id="today-calculation-title">Where this amount comes from</h2><p className="soft-copy">Two checks. The lower amount determines your allowance.</p><div className="allowance-equations">
        <div><h3>Cash coverage</h3><dl>
          <CalculationRow label="Bank balance" value={summary.currentBankBalanceLabel} detail={`${summary.hasObservedBalance ? "Imported" : "Opening balance fallback"} · ${dateLabel(summary.balanceAsOf)}`} action="Review source" onClick={event => open(0, event)} />
          <CalculationRow label="+ Upcoming income" value={summary.upcomingIncomeLabel} detail={`${summary.upcomingIncomeCount} records after the balance date`} action="Review income" href={`#income?month=${month}`} />
          <CalculationRow label="− Remaining commitments" value={summary.remainingCommittedCostsLabel} detail="Required expenses remaining in your plan" action="Edit commitments" onClick={event => open(1, event)} />
          <CalculationRow label="− Protected buffer" value={summary.bufferTargetLabel} detail="Chosen by your household" action="Change buffer" onClick={event => open(2, event)} />
          <CalculationRow label="Cash available" value={summary.cashPoolLabel} total />
        </dl></div>
        <div><h3>Flexible spending plan</h3><dl>
          <CalculationRow label="Monthly flexible budget" value={summary.flexibleGoalLabel} detail="From this month's category and cost plan" action="Edit flexible budget" onClick={event => open(1, event)} />
          <CalculationRow label="− Flexible spending recorded" value={summary.flexibleSpentLabel} detail="Cash / billing dates" action="Review spending" href={activityHref} />
          <CalculationRow label="− Committed costs over plan" value={summary.committedOverageLabel} detail="Overruns reduce the allowance" action="Review committed costs" href={planHref} />
          <CalculationRow label="Budget available" value={summary.budgetPoolLabel} total />
        </dl></div>
      </div><p className="allowance-connector">Lower amount, with a minimum of zero</p><div className="allowance-calculation-result">{summary.safeSpendPoolLabel} ÷ {summary.remainingDays} remaining days = <strong>{dailyMoney(summary.safeDailySpend)} / day</strong></div></section>}
      <p className="today-save-message" role="status">{message}</p>
      {active && <section className="today-next-step"><h2>Your next step</h2><p>{stale ? "Review the date and source of your bank balance, then update the imported data." : summary.cashPool <= 0 ? "Review required expenses and your buffer to understand the cash shortfall." : summary.flexibleGoal <= 0 ? "Choose amounts for the flexible categories in your plan." : summary.budgetPool <= 0 ? "Review recorded spending before revising your exhausted flexible budget." : "Review the flexible categories behind your remaining allowance."}</p><button className="secondary-btn" onClick={event => open(stale ? 0 : 1, event)}>{stale ? "Review imported data" : "Review spending plan"}</button></section>}
      {active && <div className="today-supporting"><section><h3>Recorded spending</h3><dl><CalculationRow label="Today" value={summary.flexibleSpentTodayLabel} /><CalculationRow label="Since Monday" value={summary.flexibleSpentThisWeekLabel} /></dl><small>Flexible expenses by cash / billing date. These can differ from purchases made today.</small></section><section><h3>What remains to cover</h3><dl><CalculationRow label="Required expenses" value={summary.remainingCommittedCostsLabel} /><CalculationRow label="Flexible spending allowance" value={summary.safeSpendPoolLabel} /></dl><small>Total budget remaining includes required expenses. Only the allowance above is available for flexible spending.</small></section></div>}
      {active && <BalanceEstimate summary={summary} />}
      {screen.unbudgetedItems[0] && <a className="text-link today-unplanned" href={`#activity?month=${month}&category=${encodeURIComponent(screen.unbudgetedItems[0].category)}`}>Review unbudgeted {screen.unbudgetedItems[0].category}: {screen.unbudgetedItems[0].actualLabel}</a>}
    </div>
  </section>;
}

function AllowanceSetup({ screen, month, initialStep, onPreview, onSharedState, onClose, onSaved }) {
  const [step, setStep] = useState(initialStep);
  const [draft, setDraft] = useState(() => ({ allocations: { ...screen.budgetPlan.allocations }, bufferTarget: screen.summary.bufferTarget }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const invalid = validateAllowanceDraft(screen.budgetPlan, draft);
  const preview = useMemo(() => invalid ? screen : onPreview(draft), [draft, invalid, screen, onPreview]);
  const summary = screen.summary;
  const previewSummary = preview.summary;
  const categories = screen.budgetPlan.categories.filter(row => !row.archived && !row.addedLater).sort((a, b) => a.order - b.order);
  const steps = ["Review data", "Plan spending", "Protect a buffer", "Review and save"];
  async function save() {
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError("");
    try {
      const result = await saveBudgetPlan({ month, allocations: Object.fromEntries(Object.entries(draft.allocations).map(([id, value]) => [id, Math.round(Number(value) * 100) / 100])), bufferTarget: Number(draft.bufferTarget) });
      onSharedState(result.sharedState); onSaved();
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <section className="panel allowance-setup" aria-labelledby="allowance-setup-title" aria-busy={busy}>
    <div className="panel-head"><h2 id="allowance-setup-title" ref={heading} tabIndex={-1}>Set up your allowance</h2><button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button></div>
    <ol className="allowance-setup-steps" aria-label="Setup progress">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <form onSubmit={event => { event.preventDefault(); if (step === 3) save(); else if (invalid && step > 0) setError(invalid); else { setError(""); setStep(step + 1); } }}>
      {step === 0 && <div><h3>Start with the numbers already loaded</h3><dl><CalculationRow label={summary.hasObservedBalance ? "Bank balance" : "Opening balance fallback"} value={summary.currentBankBalanceLabel} detail={`${summary.hasObservedBalance ? "Imported" : "No confirmed bank balance loaded"} · ${dateLabel(summary.balanceAsOf)}`} /><CalculationRow label="Upcoming cash income" value={summary.upcomingIncomeLabel} detail="Dated after the recorded balance" /></dl>{summary.upcomingIncomeRows.length > 0 && <ul className="allowance-income-records">{summary.upcomingIncomeRows.map((row, index) => <li key={`${row.source}-${index}`}><span>{row.source}<small>{dateLabel(row.date)} · {row.expected ? "Expected" : "Loaded income record"}</small></span><strong>{money(row.amount)}</strong></li>)}</ul>}
        {(summary.latestBalanceAge > 3 || !summary.hasObservedBalance) && <p className="allowance-warning">{!summary.hasObservedBalance ? "A confirmed bank balance is missing." : `The balance is ${summary.latestBalanceAge} days old.`} Budget changes will not make it current.</p>}
        <p className="soft-copy">Balance, income and recorded expenses come from imported data. This setup does not edit them. To update them, provide fresh bank or card exports through the import workflow.</p><div className="allowance-source-links"><a className="text-link" href={`#activity?month=${month}&basis=billing`}>Inspect recorded transactions</a><a className="text-link" href={`#income?month=${month}`}>Inspect income records</a><a className="text-link" href={`#settings?panel=data&month=${month}`}>Data and import history</a></div></div>}
      {step === 1 && <div><h3>Cover required costs, then plan flexible spending</h3><p className="soft-copy">Set monthly category amounts for {formatMonth(month)}. Existing known costs and groups stay reserved inside each total.</p><button className="text-link" type="button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show active categories" : "Show all categories"}</button><div className="allowance-category-list">{categories.filter(category => showAll || category.planned > 0 || category.actual > 0).map(category => {
        const reserved = categoryReservations(category);
        const mixed = category.subcategories.some(child => !child.archived && child.commitment !== category.commitment);
        return <label className="allowance-category-field" key={category.id}><span><strong>{category.name}</strong><small>{mixed ? "Mixed required and flexible costs" : category.commitment === "committed" ? "Committed · Required expenses" : "Flexible · Adjustable spending"}{reserved > 0 ? ` · ${money(reserved)} reserved` : ""}</small></span><span className="allowance-category-input"><span aria-hidden="true">{CURRENCY}</span><input aria-label={`${category.name} monthly budget`} type="number" min={reserved} max="1000000000" step="0.01" required value={draft.allocations[category.id] ?? 0} onChange={event => { setError(""); setDraft({ ...draft, allocations: { ...draft.allocations, [category.id]: event.target.value } }); }} /></span></label>;
      })}</div><p className="soft-copy">These edits apply to this month only. To change classifications, known costs, or the baseline for later months, use <a href={`#settings?panel=budgets&month=${month}`}>Settings → Budgets</a>.</p><div className="allowance-draft-total" aria-live="polite">{invalid ? "Complete the amounts to see a preview." : `Preview: ${money(preview.budgetPlan.committedPlanned)} committed · ${money(preview.budgetPlan.flexiblePlanned)} flexible`}</div></div>}
      {step === 2 && <div><h3>How much should stay protected?</h3><label className="field allowance-buffer-field"><span>Comfort buffer ({CURRENCY})</span><input type="number" min="0" max="1000000000" step="0.01" required value={draft.bufferTarget} onChange={event => { setError(""); setDraft({ ...draft, bufferTarget: event.target.value }); }} /><small>This amount is reserved before calculating your allowance. The buffer is shared across your household and months.</small></label><p className="soft-copy">The buffer is a planning preference. Changing it does not move money into another account.</p></div>}
      {step === 3 && <div><h3>Your allowance preview</h3><div className="allowance-preview" aria-live="polite"><div className="allowance-amount">{dailyMoney(previewSummary.safeDailySpend)} <span>/ day</span></div><p>{previewSummary.safeSpendPoolLabel} available · {previewSummary.remainingDays} remaining days</p><dl><CalculationRow label="Cash available after commitments and buffer" value={previewSummary.cashPoolLabel} /><CalculationRow label="Flexible budget available after spending and overruns" value={previewSummary.budgetPoolLabel} /><CalculationRow label="Estimated closing balance" value={previewSummary.projectedEndBalanceLabel} /><CalculationRow label="Total monthly plan" value={money(previewSummary.totalBudgetGoal)} /><CalculationRow label="Protected buffer" value={previewSummary.bufferTargetLabel} /></dl></div><p className="soft-copy">Save the plan for {formatMonth(month)} and the household buffer together. Nothing has been saved yet.</p>{summary.latestBalanceAge > 3 || !summary.hasObservedBalance ? <p className="allowance-warning">This remains an estimate until your bank balance is updated.</p> : null}</div>}
      {error && <p className="form-message error" role="alert">{error}</p>}
      <div className="allowance-setup-actions">{step > 0 && <button className="secondary-btn" type="button" disabled={busy} onClick={() => { setError(""); setStep(step - 1); }}>Back</button>}<button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving…" : step === 3 ? "Save month plan and buffer" : "Continue"}</button></div>
    </form>
  </section>;
}

function BalanceEstimate({ summary }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width))); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  const height = 190, left = 70, right = 22, top = 18, bottom = 35;
  const values = [summary.currentBankBalance, summary.projectedEndBalance, summary.bufferTarget];
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const y = value => top + (max - value) / (max - min || 1) * (height - top - bottom);
  const end = width - right;
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const shortDate = date => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  return <section className="today-balance-estimate" ref={ref}><h2>How the month could end</h2><div className="legend"><span><i className="line projected" />Balance after using the allowance</span><span><i className="line baseline" />Protected buffer · {summary.bufferTargetLabel}</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Month-end estimate: ${summary.currentBankBalanceLabel} today to ${summary.projectedEndBalanceLabel} at month-end; protected buffer ${summary.bufferTargetLabel}. Payment dates are not modeled.`}>
    {[min, (max + min) / 2, max].map((value, index) => <g key={index}><line className="forecast-grid" x1={left} x2={end} y1={y(value)} y2={y(value)} /><text className="forecast-label" x={left - 10} y={y(value) + 4} textAnchor="end">{money(value)}</text></g>)}
    <line className="forecast-baseline" x1={left} x2={end} y1={y(summary.bufferTarget)} y2={y(summary.bufferTarget)} /><line className="forecast-projected" x1={left} x2={end} y1={y(summary.currentBankBalance)} y2={y(summary.projectedEndBalance)} />
    <text className="forecast-label" x={left} y={height - 8}>{shortDate(now)}</text><text className="forecast-label" x={end} y={height - 8} textAnchor="end">{shortDate(last)}</text>
  </svg><p className="soft-copy">Month-end estimate from the loaded balance. Assumes upcoming income arrives and you spend the available allowance. The straight line does not model payment dates.</p></section>;
}
