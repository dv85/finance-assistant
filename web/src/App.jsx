"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowRight,
  Bank,
  Basket,
  CalendarBlank,
  CaretDown,
  Car,
  ChartBar,
  ChartPieSlice,
  Check,
  Clock,
  Crosshair,
  ForkKnife,
  Gear,
  Heart,
  House,
  Money,
  Phone,
  Question,
  Receipt,
  TrendUp,
  Users,
  UsersThree,
  Warning,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import {
  addHouseholdMember,
  addCashReport,
  loadHouseholdMembers,
  removeHouseholdMember,
  deleteCashReport,
  downloadSharedBackup,
  importFinanceBundle,
  importSharedBackup,
  loadFinanceData,
  resetBudgetOverrides,
  resetRecurringOverrides,
  saveCategorySettings,
  saveBudgetOverrides,
  saveRecurringOverrides,
  saveSharedSettings
} from "./lib/dataSource.js";
import {
  setDisplayCurrency,
  CURRENCY,
  applySharedState,
  buildBudgetTrendData,
  buildScreenData,
  categoryIcon,
  decorateTransactions,
  formatMonth,
  isBudgetExpense,
  merchantDescription,
  money,
  monthShortDayFromDate,
  normalizedMerchantName,
  number,
  sum
} from "./lib/finance.js";
import { resolveBudgetBasis } from "./lib/routing.js";
import BudgetPlanEditor from "./BudgetPlanEditor.jsx";
import Today from "./Today.jsx";
import { localCalendarDate, previewAllowance } from "./lib/allowance.js";
import MerchantReport from "./MerchantReport.jsx";
import { merchantReportHref } from "./lib/merchantReports.js";

const NAV = [
  ["today", "Today", "home"],
  ["budget", "Budget", "pie"],
  ["commitments", "Commitments", "calendar"],
  ["income", "Income", "down"],
  ["activity", "Activity", "activity"],
  ["settings", "Settings", "settings"]
];

const ICONS = {
  activity: ChartBar,
  alert: WarningCircle,
  arrow: ArrowRight,
  bank: Bank,
  calendar: CalendarBlank,
  cash: Money,
  check: Check,
  chevron: CaretDown,
  clock: Clock,
  close: X,
  dining: ForkKnife,
  down: ArrowCircleDown,
  family: UsersThree,
  groceries: Basket,
  health: Heart,
  help: Question,
  home: House,
  phone: Phone,
  pie: ChartPieSlice,
  receipt: Receipt,
  settings: Gear,
  target: Crosshair,
  transport: Car,
  trend: TrendUp,
  up: ArrowCircleUp,
  users: Users,
  warning: Warning
};

function Icon({ name }) {
  const IconComponent = ICONS[name] || ICONS.receipt;
  return <IconComponent aria-hidden="true" weight="regular" />;
}

function routeFromHash() {
  const raw = typeof window === "undefined" ? "today" : window.location.hash.slice(1);
  const [view, query = ""] = raw.split("?");
  return { view: view === "merchant" || NAV.some(([key]) => key === view) ? view : "today", params: new URLSearchParams(query) };
}

function setRoute(view, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  window.location.hash = `${view}${query.size ? `?${query}` : ""}`;
}

function currentCalendarMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentDateLabel() {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

function readableImportTime(value) {
  if (!value) return "Loaded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Loaded";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function App({ user, isOwner }) {
  const [payload, setPayload] = useState({ status: "loading" });
  const [route, setRouteState] = useState({ view: "today", params: new URLSearchParams() });
  const [month, setMonth] = useState(null);

  async function refresh() {
    setPayload((current) => current.status === "ready" ? current : { status: "loading" });
    try {
      const data = await loadFinanceData();
      if (!data.state || !data.ledger) setPayload({ status: "empty", ...data });
      else {
        setDisplayCurrency(data.state.currency);
        setMonth((current) => current || routeFromHash().params.get("month") || currentCalendarMonth());
        setPayload({ status: "ready", ...data });
      }
    } catch (error) {
      setPayload({ status: "error", error });
    }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const update = () => {
      const next = routeFromHash();
      setRouteState(next);
      const requested = next.params.get("month");
      if (requested) setMonth(requested);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  if (payload.status === "loading") return <StatePanel title="Opening your finance workspace" detail="Loading your local ledger and household settings." />;
  if (payload.status === "error") return <StatePanel title="Could not load finance data" detail={payload.error?.message || "Please refresh and try again."} retry={refresh} />;
  if (payload.status === "empty") return <EmptyState isOwner={isOwner} onComplete={refresh} />;

  const selected = month || currentCalendarMonth();
  const model = applySharedState(payload.state, payload.ledger, payload.sharedState, selected);
  const budgetBasis = resolveBudgetBasis(route.view, route.params.get("basis"));
  const screen = buildScreenData(model.state, model.ledger, selected, localCalendarDate(), budgetBasis, payload.sharedState);
  const trendCategory = route.view === "activity" ? route.params.get("category") : null;
  const budgetTrend = route.view === "activity"
    ? buildBudgetTrendData(payload.state, payload.ledger, payload.sharedState, selected, trendCategory, budgetBasis)
    : null;
  const updateSharedState = (sharedState) => setPayload((current) => ({ ...current, sharedState }));
  const changeMonth = (value) => {
    setMonth(value);
    setRoute(route.view, { month: value, category: route.params.get("category"), report: route.params.get("report"), basis: route.params.get("basis"), panel: route.params.get("panel"), q: new URLSearchParams(window.location.hash.split("?")[1] || "").get("q") });
  };

  return (
    <div className="app-shell">
      <Sidebar view={route.view === "merchant" ? "activity" : route.view} user={user} />
      <MobileHeader />
      <main className="main-content">
        {route.view === "today" && <Today key={selected} screen={screen} month={selected} onMonth={changeMonth} sharedState={payload.sharedState} onSharedState={updateSharedState} onPreview={(draft) => previewAllowance(payload.state, payload.ledger, payload.sharedState, selected, draft)} />}
        {route.view === "budget" && <Budget key={`${selected}-${budgetBasis}`} screen={screen} month={selected} onMonth={changeMonth} route={route} getTrend={(category = null, end = selected) => buildBudgetTrendData(payload.state, payload.ledger, payload.sharedState, selected, category, budgetBasis, end)} />}
        {route.view === "commitments" && <Commitments screen={screen} month={selected} onMonth={changeMonth} />}
        {route.view === "income" && <Income screen={screen} month={selected} onMonth={changeMonth} />}
        {route.view === "activity" && <Activity screen={screen} month={selected} onMonth={changeMonth} route={route} trend={budgetTrend} />}
        {route.view === "merchant" && <MerchantReport ledger={model.ledger} route={route} month={selected} renderTransactions={(rows) => <TransactionList rows={rows} showCard merchantLinks={false} fullDates metaFor={(tx) => tx.type === "refund" || Number(tx.amount) < 0 ? "Credit / refund" : null} />} />}
        {route.view === "settings" && <Settings
          state={model.state}
          originalState={payload.state}
          ledger={payload.ledger}
          sharedState={payload.sharedState}
          screen={screen}
          month={selected}
          onMonth={changeMonth}
          onSharedState={updateSharedState}
          onRefresh={refresh}
          getTrend={(category) => buildBudgetTrendData(payload.state, payload.ledger, payload.sharedState, selected, category, budgetBasis)}
          isOwner={isOwner}
          user={user}
        />}
      </main>
      <MobileNav view={route.view === "merchant" ? "activity" : route.view} />
    </div>
  );
}

function StatePanel({ title, detail, retry }) {
  return <main className="state-shell"><section className="state-panel"><BrandMark /><h1>{title}</h1><p>{detail}</p>{retry && <button className="primary-btn" onClick={retry}>Try again</button>}</section></main>;
}

function EmptyState({ isOwner, onComplete }) {
  return (
    <main className="state-shell">
      <section className="state-panel">
        <BrandMark />
        <h1>Your private workspace is connected</h1>
        <p>{isOwner ? "No active ledger snapshot is available yet. Run the normal transaction workflow to synchronize it locally, or use recovery import below." : "The household ledger is still being synchronized. Please try again shortly."}</p>
        <p className="sync-note">Run the validated local sync after each import</p>
        <div className="state-actions"><button className="primary-btn" onClick={onComplete}>Check again</button><a className="secondary-btn" href="#settings?panel=data">Local workspace</a></div>
        {isOwner && <details className="panel recovery-panel"><summary>Owner recovery import</summary><ImportPanel onComplete={onComplete} /></details>}
      </section>
    </main>
  );
}

function BrandMark({ small = false }) {
  return <span className={`brand-mark${small ? " small" : ""}`} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="m8.8 15.2 2.1-4.9 4.3-1.5-2.1 4.9-4.3 1.5Z" /><path d="m11 13 2-2" /></svg></span>;
}

function Sidebar({ view, user }) {
  return (
    <aside className="sidebar" aria-label="App navigation">
      <a className="brand" href="#today"><BrandMark /><span><strong>Cashflow Repair</strong><em>Personal</em></span></a>
      <nav className="nav-list" aria-label="Primary">
        {NAV.map(([key, label, icon]) => <a className={`nav-link ${view === key ? "active" : ""}`} href={`#${key}`} data-view={key} key={key}><span className="icon"><Icon name={icon} /></span>{label}</a>)}
      </nav>
      <div className="sidebar-spacer" />
      <section className="sidebar-note"><span className="icon"><Icon name="help" /></span><div><strong>Private account</strong><a href="#activity">Ledger and budget data</a></div></section>
      <a className="profile-card hosted-profile" href="#settings?panel=data"><span className="icon"><Icon name="bank" /></span><div><strong>{user.displayName || "Private account"}</strong><small>{user.email}</small></div><span className="icon"><Icon name="chevron" /></span></a>
    </aside>
  );
}

function MobileHeader() {
  return <header className="mobile-app-header"><a className="mobile-brand" href="#today"><BrandMark small /><strong>Cashflow Repair</strong></a><span>Personal</span></header>;
}

function MobileNav({ view }) {
  return <nav className="mobile-bottom-nav" aria-label="Mobile primary">{NAV.map(([key, label, icon]) => <a className={view === key ? "active" : ""} href={`#${key}`} aria-current={view === key ? "page" : undefined} key={key}><span className="icon"><Icon name={icon} /></span><span>{label}</span></a>)}</nav>;
}

function MonthSelect({ month, months, onChange, className = "screen-month" }) {
  return <label className={`month-select ${className}`}><span className="icon"><Icon name="calendar" /></span><select aria-label="Month selector" value={month} onChange={(event) => onChange(event.target.value)}>{months.map((item) => <option value={item} key={item}>{formatMonth(item)}</option>)}</select></label>;
}

function ScreenHeader({ title, copy, screen, month, onMonth, children }) {
  return <header className="screen-header"><div><h1>{title}</h1><p>{copy}</p></div>{children || <MonthSelect month={month} months={screen.availableMonths} onChange={onMonth} />}</header>;
}

function Metric({ label, value, detail, icon, tone = "ok" }) {
  return <article className={`metric-item ${tone}`}>{icon && <span className="metric-icon"><Icon name={icon} /></span>}<div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div></article>;
}

const BUDGET_STATUS_PRIORITY = { risk: 0, unbudgeted: 1, watch: 2, ok: 3 };

function budgetSortValue(row, key) {
  if (key === "category") return row.category;
  if (key === "status") return BUDGET_STATUS_PRIORITY[row.statusKey] ?? 4;
  if (key === "share") return number(row.actual);
  return number(row[key]);
}

function sortBudgetRows(rows, sort) {
  return [...rows].sort((a, b) => {
    const first = budgetSortValue(a, sort.key);
    const second = budgetSortValue(b, sort.key);
    const comparison = typeof first === "string"
      ? first.localeCompare(second, undefined, { sensitivity: "base" })
      : first - second;
    return comparison * sort.direction || a.category.localeCompare(b.category);
  });
}

function Budget({ screen, month, onMonth, route, getTrend }) {
  const [sort, setSort] = useState({ key: "goal", direction: -1 });
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const report = ["weekly", "daily"].includes(route.params.get("report")) ? route.params.get("report") : "monthly";
  const rows = sortBudgetRows(screen.budgetRows, sort).filter((row) => !attentionOnly || row.statusKey !== "ok");
  const periodLabel = screen.isActiveMonth ? `${screen.summary.remainingDays} days left · Partial month` : month > currentCalendarMonth() ? "Planned month" : "Month ended";
  const sortOptions = { goal: -1, actual: -1, status: 1, category: 1 };
  return <section className="view active budget-view budget-clean" data-screen="budget">
    <ScreenHeader title="Budget" screen={screen} month={month} onMonth={onMonth}>
      <div className="screen-header-controls"><BudgetBasisToggle basis={screen.budgetBasis} onChange={(basis) => setRoute("budget", { month, basis, report, week: route.params.get("week"), day: route.params.get("day") })} /><div className="budget-month-control"><MonthSelect month={month} months={screen.budgetAvailableMonths} onChange={onMonth} /><small>{periodLabel}</small></div></div>
    </ScreenHeader>
    <BudgetPlanningSummary plan={screen.budgetPlan} screen={screen} month={month} />
    <div className="budget-context">
      <details className="budget-more"><summary>More details</summary><div className="budget-secondary-metrics">{[1, 3, 4].map((index) => { const item = screen.budgetSummary[index]; return <div key={index}><span>{index === 1 ? "Budget pace" : item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div>; })}</div><p>{screen.budgetBasis === "installments" ? "Purchase costs are spread from purchase month; card billing dates may differ." : "Full purchase costs are counted once in the month bought."} Category goals are shared between modes. {screen.budgetBasis === "installments" ? "Full purchase cost" : "Monthly installments"}: {money(screen.alternateBudgetTotal)}. Cash limits use bank cash flow independently of this choice.</p></details>
      {(screen.allocationEstimatedTotal > 0 || screen.allocationReviewCount > 0) && <p className="budget-estimate-note">{screen.allocationEstimatedTotal > 0 && `${money(screen.allocationEstimatedTotal)} estimated portions`}{screen.allocationEstimatedTotal > 0 && screen.allocationReviewCount > 0 && " · "}{screen.allocationReviewCount > 0 && `${screen.allocationReviewCount} installment plans need review`}</p>}
    </div>
    <nav className="budget-report-tabs" aria-label="Budget report type">{[["monthly", "Monthly plan"], ["weekly", "Weekly spending"], ["daily", "Daily report"]].map(([value, label]) => <a key={value} className={`budget-report-tab ${report === value ? "active" : ""}`} href={`#budget?month=${month}&basis=${screen.budgetBasis}&report=${value}`} aria-current={report === value ? "page" : undefined}>{label}</a>)}</nav>
    {report === "monthly" ? <>
      <BudgetComparison getTrend={getTrend} />
      <section className="panel budget-category-report" aria-labelledby="budgetCategoryTitle">
        <div className="budget-category-toolbar"><h2 id="budgetCategoryTitle">Categories</h2><div><label className="budget-attention"><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />Needs attention</label><select aria-label="Sort budget categories" value={sort.key} onChange={(event) => setSort({ key: event.target.value, direction: sortOptions[event.target.value] })}><option value="goal">Highest budget</option><option value="actual">Highest spend</option><option value="status">Needs attention</option><option value="category">Category A–Z</option></select></div></div>
        <div className="budget-column-labels" aria-hidden="true"><span>Category</span><span>Spent / Budget</span><span>Left / Over</span></div>
        <ul className="budget-category-list">{rows.map((row, index) => {
          const open = expandedCategory === row.category;
          const percent = row.hasGoal ? Math.round(row.actual / row.goal * 100) : 0;
          const remaining = row.hasGoal ? `${money(Math.abs(row.remaining))} ${row.remaining < 0 ? "over" : "left"}` : "No budget";
          return <li key={row.category}>
            <button className={`budget-category-toggle ${open ? "is-open" : ""}`} aria-expanded={open} aria-controls={`category-detail-${index}`} onClick={() => setExpandedCategory(open ? null : row.category)}>
              <span className="budget-category-name"><span className="category-icon"><Icon name={categoryIcon(row.category)} /></span><span><strong>{row.category}</strong>{row.recurringMinimum > 0 ? <small>{money(row.recurringMinimum)} recurring minimum</small> : row.statusKey !== "ok" && <small className={row.remaining < 0 ? "negative" : ""}>{row.status}</small>}</span></span>
              <span className="budget-category-spent"><span><strong>{row.actualLabel}</strong><small> / {row.hasGoal ? row.goalLabel : "No budget"}</small></span>{row.hasGoal && <span className={`budget-utilization ${row.remaining < 0 ? "is-over" : ""}`} role="progressbar" aria-label={`${row.category} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, percent))} aria-valuetext={`${percent}% spent`}><i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></span>}</span>
              <span className={`budget-category-balance ${row.remaining < 0 ? "negative" : ""}`}>{remaining}<Icon name="chevron" /></span>
            </button>
            {open && <BudgetCategoryDetail key={`${month}-${screen.budgetBasis}-${row.category}`} id={`category-detail-${index}`} row={row} planCategory={screen.budgetPlan.categories.find((item) => item.name === row.category)} screen={screen} month={month} getTrend={getTrend} />}
          </li>;
        })}</ul>
        {!rows.length && <p className="budget-empty">{attentionOnly ? "No categories need attention." : "No categories for this month."}</p>}
        <p className="table-note">All amounts in {CURRENCY}</p>
      </section>
      <details className="panel budget-recent"><summary>{screen.budgetBasis === "installments" ? "Recent budget allocations" : "Recent purchases"}</summary><TransactionList rows={screen.budgetTransactions.slice(0, 6)} showCard /><a href={`#activity?month=${month}&basis=${screen.budgetBasis}`}>View all activity</a></details>
    </> : report === "weekly" ? <Weekly screen={screen} month={month} route={route} /> : <Daily screen={screen} month={month} route={route} />}
  </section>;
}

function BudgetPlanningSummary({ plan, screen, month }) {
  const remaining = plan.unallocated;
  return <section className="budget-planning" aria-labelledby="budgetPlanningTitle">
    <div className="budget-planning-head"><div><h2 id="budgetPlanningTitle">Your monthly plan</h2><p>Cover commitments first, then decide what is available for flexible spending.</p></div><a className="secondary-btn" href={`#settings?panel=budgets&month=${month}`}>Edit plan</a></div>
    <div className="budget-planning-grid">
      <div><span>Expected income</span><strong>{money(plan.income)}</strong><small>Income planned for {formatMonth(month)}</small></div>
      <div><span>Committed</span><strong>{money(plan.committedPlanned)}</strong><small>Bills and required costs</small></div>
      <div><span>Flexible</span><strong>{money(plan.flexiblePlanned)}</strong><small>Spending you can adjust</small></div>
      <div><span>Known future costs</span><strong>{money(plan.periodicPlanned)}</strong><small>Included in the two amounts above</small></div>
      <div className={remaining < 0 ? "is-negative" : "is-positive"}><span>{remaining < 0 ? "Plan exceeds income" : "Income not yet allocated"}</span><strong>{money(Math.abs(remaining))}</strong><small>Income minus the full plan</small></div>
    </div>
    <div className="budget-planning-actuals"><span><strong>{money(screen.budgetTotal.actual)}</strong> spent {screen.isActiveMonth ? "so far" : "this month"}</span><span><strong>{money(screen.recurringPlan.remaining)}</strong> still expected from linked recurring costs</span><span><strong>{money(screen.summary.safeSpendPool)}</strong> safe to spend now · based on cashflow</span></div>
  </section>;
}

function RecurringSummary({ plan, month }) {
  const [expanded, setExpanded] = useState(false);
  if (!plan?.items?.length) return null;
  const closed = month < currentCalendarMonth();
  const actionable = plan.items.filter((item) => item.included && (closed
    ? item.statusKey === "missing" || item.over > 1
    : item.remaining > 1 || item.over > 1));
  const summaryId = "recurring-budget-summary";
  const amountLabel = closed ? "Not matched" : "Still expected";
  const count = closed ? plan.items.filter((item) => item.included && item.statusKey === "missing").length : plan.outstandingCount;
  const detail = closed
    ? `${count} recurring cost${count === 1 ? "" : "s"} not found in the closed month`
    : `${count} recurring cost${count === 1 ? "" : "s"} remaining · ${money(plan.actual)} matched in the ledger`;
  return <section className={`panel recurring-compact ${expanded ? "is-open" : ""}`} aria-labelledby="recurringCompactTitle">
    <div className="recurring-compact-head">
      <button className="recurring-compact-toggle" type="button" aria-expanded={expanded} aria-controls={summaryId} onClick={() => setExpanded(!expanded)}>
        <span className="category-icon"><Icon name="receipt" /></span>
        <span className="recurring-compact-copy"><strong id="recurringCompactTitle">Recurring costs</strong><small>{detail}</small></span>
        <span className="recurring-compact-amount"><small>{amountLabel}</small><strong>{money(plan.remaining)}</strong>{plan.over > 1 && <em>{money(plan.over)} over plan</em>}</span>
        <span className="recurring-compact-chevron"><Icon name="chevron" /></span>
      </button>
      <a className="recurring-manage-link" href={`#settings?panel=budgets&subpanel=recurring&month=${month}`}>Manage</a>
    </div>
    {expanded && <div className="recurring-compact-detail" id={summaryId}>
      {actionable.length ? <div className="recurring-compact-list">{actionable.map((item) => <article key={item.id}>
        <span><strong>{item.name}</strong><small>{item.category} · {item.status}</small></span>
        <span><strong>{item.over > 1 ? `${money(item.over)} over` : `${money(item.remaining)} expected`}</strong><small>{money(item.actual)} paid of {money(item.planned)}</small></span>
      </article>)}</div> : <p className="soft-copy">Every included recurring cost is accounted for.</p>}
      <p className="recurring-compact-note">Recurring matches use billing or posted month. Edit amounts and inclusion choices in Settings.</p>
    </div>}
  </section>;
}

function RecurringCostEditor({ plan, month, onSharedState }) {
  const initialDraft = () => Object.fromEntries((plan?.items || []).map((item) => [item.id, {
    amount: item.included ? item.planned : number(item.monthlyFunding || item.baseMonthlyFunding),
    included: item.included,
  }]));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(initialDraft()); setEditing(false); setMessage(null); }, [month, plan?.overrideCount]);
  if (!plan?.items?.length) return null;

  const draftTotal = sum(plan.items.filter((item) => draft[item.id]?.included), (item) => draft[item.id]?.amount);
  async function save(event) {
    event.preventDefault();
    const overrides = Object.fromEntries(plan.items.flatMap((item) => {
      const value = draft[item.id] || { amount: item.baseMonthlyFunding, included: true };
      const amount = Math.max(0, number(value.amount));
      return value.included && amount === item.baseMonthlyFunding ? [] : [[item.id, { amount, included: Boolean(value.included) }]];
    }));
    setSaving(true); setMessage(null);
    try {
      const result = await saveRecurringOverrides(month, overrides);
      onSharedState(result.sharedState);
      setEditing(false);
      setMessage({ tone: "success", text: `Recurring plan saved for ${formatMonth(month)}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally { setSaving(false); }
  }
  async function reset() {
    setSaving(true); setMessage(null);
    try {
      const result = await resetRecurringOverrides(month);
      onSharedState(result.sharedState);
      setEditing(false);
      setMessage({ tone: "success", text: `Reviewed defaults restored for ${formatMonth(month)}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message });
    } finally { setSaving(false); }
  }

  return <section className="panel recurring-planner" aria-labelledby="recurringPlanTitle">
    <div className="panel-head recurring-plan-head"><div><h2 id="recurringPlanTitle">Recurring costs</h2><p className="soft-copy">Committed minimums inside each category budget for {formatMonth(month)}.</p></div><div className="recurring-plan-actions">{editing ? <><button className="secondary-btn" type="button" onClick={() => { setDraft(initialDraft()); setEditing(false); }} disabled={saving}>Cancel</button><button className="primary-btn" type="submit" form="recurring-plan-form" disabled={saving}>{saving ? "Saving…" : "Save month"}</button></> : <button className="secondary-btn" type="button" onClick={() => setEditing(true)}>Edit this month</button>}</div></div>
    <div className="recurring-plan-summary" aria-label="Recurring plan summary"><div><span>Planned</span><strong>{money(editing ? draftTotal : plan.total)}</strong><small>{editing ? "Draft for this month" : `${plan.count} included costs · ${money(plan.budgetIncrease)} added to category budgets`}</small></div><div><span>Paid or billed</span><strong>{money(plan.actual)}</strong><small>Matched from transaction history</small></div><div><span>Still expected</span><strong>{money(plan.remaining)}</strong><small>{plan.over > 0 ? `${money(plan.over)} over plan across paid costs` : plan.overrideCount ? `${plan.overrideCount} monthly override${plan.overrideCount === 1 ? "" : "s"}` : "Using reviewed defaults"}</small></div></div>
    <form id="recurring-plan-form" onSubmit={save}>
      <div className="recurring-plan-columns" aria-hidden="true"><span>Cost</span><span>Category</span><span>Plan</span><span>Actual</span><span>Status</span></div>
      <div className="recurring-plan-list">{plan.items.map((item) => {
        const value = draft[item.id] || { amount: item.baseMonthlyFunding, included: true };
        return <div className={`recurring-plan-row ${!value.included ? "is-excluded" : ""}`} key={item.id}>
          <div className="recurring-plan-name">{editing && <input type="checkbox" checked={value.included} onChange={(event) => setDraft({ ...draft, [item.id]: { ...value, included: event.target.checked } })} aria-label={`Include ${item.name} in ${formatMonth(month)}`} />}<span><strong>{item.name}</strong><small>{item.confidence === "estimated" ? "Estimated amount" : "Confirmed recurring cost"}</small></span></div>
          <span className="recurring-plan-category">{item.category}</span>
          <span className="recurring-plan-amount">{editing ? <label><span className="sr-only">{item.name} planned amount</span><input type="number" min="0" step="1" value={value.amount} disabled={!value.included} onChange={(event) => setDraft({ ...draft, [item.id]: { ...value, amount: event.target.value } })} /></label> : <strong>{money(item.planned)}</strong>}</span>
          <span className="recurring-plan-actual">{money(item.actual)}</span>
          <span className={`recurring-plan-status ${item.statusKey}`}>{value.included ? item.status : "Excluded"}</span>
        </div>;
      })}</div>
    </form>
    <div className="recurring-plan-footer"><p className={`save-state ${message?.tone || ""}`} role="status">{message?.text || "Recurring transactions use billing or posted month, independently of the budget cost mode."}</p>{!editing && plan.overrideCount > 0 && <button className="budget-text-button" type="button" onClick={reset} disabled={saving}>Reset month to reviewed defaults</button>}</div>
  </section>;
}

function BudgetCategoryDetail({ id, row, planCategory, screen, month, getTrend }) {
  const [filter, setFilter] = useState("all");
  const [groupBy, setGroupBy] = useState("none");
  const transactionGroups = screen.budgetPlan.transactionGroups;
  const all = decorateTransactions(transactionGroups?.byCategory[planCategory?.id] || []);
  const children = planCategory?.subcategories || [];
  const childById = new Map(children.map((item) => [item.id, item]));
  const matchFor = (tx) => childById.get(transactionGroups?.matchByTransaction[tx.id]);
  const coverageFor = (tx) => matchFor(tx)?.kind === "cost" && number(matchFor(tx).planned) > 0 ? "Named planned cost"
    : number(planCategory?.planned) > 0 ? "Covered by category" : "No plan";
  const reviewFor = (tx) => tx.categoryReviewed !== true || tx.recurringCostId && tx.recurringReviewed !== true;
  const visible = all.filter((tx) => filter === "all" ||
    filter === "cost" && coverageFor(tx) === "Named planned cost" ||
    filter === "covered" && coverageFor(tx) === "Covered by category" ||
    filter === "no-plan" && coverageFor(tx) === "No plan");
  const groups = new Map();
  for (const tx of visible) {
    const matched = matchFor(tx);
    const label = groupBy === "coverage" ? coverageFor(tx)
      : groupBy === "recurring" ? tx.recurringCostId ? "Recurring transactions" : "Other transactions"
        : groupBy === "subcategory" ? matched?.kind === "group" ? matched.name
          : matched?.parentSubcategoryId && !childById.get(matched.parentSubcategoryId)?.archived
            ? childById.get(matched.parentSubcategoryId)?.name || "Other category spending"
            : "Other category spending" : "All transactions";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(tx);
  }
  const knownCosts = children.filter((item) => item.kind === "cost" && (!item.archived || item.planned || item.actual));
  const reviewCount = all.filter(reviewFor).length;
  const activityHref = `#activity?month=${month}&basis=${screen.budgetBasis}&category=${encodeURIComponent(planCategory?.sourceNames?.[0] || row.category)}`;
  return <div className="budget-inline-detail" id={id}>
    <div className="budget-detail-heading"><h3>{row.category} transactions</h3><span>{all.length} transactions{reviewCount ? ` · ${reviewCount} need import review` : ""}</span></div>
    {knownCosts.length > 0 && <details className="budget-known-costs"><summary>Known costs · {money(knownCosts.reduce((total, item) => total + number(item.planned), 0))} planned · {money(knownCosts.reduce((total, item) => total + number(item.actual), 0))} spent</summary><div className="budget-known-cost-list">{knownCosts.map((item) => {
      const recurring = item.recurringCostId ? screen.recurringPlan.items.find((cost) => cost.id === item.recurringCostId) : null;
      return <div key={item.id} className="budget-known-cost-row"><strong>{item.name}</strong><span>{item.commitment} · {item.schedule}</span><span>{money(item.planned)} planned</span><span>{money(item.actual)} spent</span><span className={item.remaining < 0 ? "negative" : ""}>{item.remaining < 0 ? `${money(-item.remaining)} over` : `${money(item.remaining)} still expected`}</span>{recurring && <small>Cashflow: {money(recurring.actual)} paid or billed · {money(recurring.remaining)} still expected</small>}</div>;
    })}</div></details>}
    <div className="budget-transaction-controls"><label>Show <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All transactions</option><option value="cost">Named planned costs</option><option value="covered">Covered by category</option><option value="no-plan">No plan</option></select></label><label>Group by <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="none">None</option><option value="coverage">Plan coverage</option><option value="recurring">Recurring or other</option><option value="subcategory">Subcategory</option></select></label></div>
    {visible.length ? [...groups].map(([label, transactions]) => <section className="budget-transaction-group" key={label} aria-label={label}>{groupBy !== "none" && <h4>{label} <small>{transactions.length} · {money(transactions.reduce((total, tx) => total + number(tx.amount), 0))}</small></h4>}<TransactionList rows={transactions} showCard metaFor={(tx) => <><span className="budget-coverage-label">{coverageFor(tx)}</span>{matchFor(tx)?.kind === "group" && <span> · {matchFor(tx).name}</span>}{reviewFor(tx) && <span className="budget-review-label"> · Needs import review</span>}</>} /></section>) : <p className="soft-copy">No transactions match this view for {formatMonth(month)}.</p>}
    <div className="budget-subcategory-actions"><a href={`#settings?panel=budgets&month=${month}`}>Edit plan and optional groups</a>{reviewCount > 0 && <a href={activityHref}>Review imports</a>}</div>
    <details className="budget-category-insights"><summary>Category insights and history</summary>
      <dl className="budget-detail-metrics"><div><dt>Budget</dt><dd>{row.goalLabel}</dd></div><div><dt>{screen.isActiveMonth ? "Expected by today" : "Expected for month"}</dt><dd>{row.hasGoal ? row.expectedLabel : "No budget"}</dd></div><div><dt>Share of spending</dt><dd>{screen.budgetTotal.actual ? Math.round(row.actual / screen.budgetTotal.actual * 100) : 0}%</dd></div></dl>
      <p className="soft-copy">{row.hasGoal ? `Budget pace compares spending with the portion of the monthly goal elapsed. ${row.status === "Watch" ? "Spending is ahead of that pace." : ""}` : "Spending in this category has no monthly budget."}</p>
      <BudgetComparison getTrend={getTrend} category={row.category} />
    </details>
  </div>;
}

function BudgetComparison({ getTrend, category = null }) {
  const [expanded, setExpanded] = useState(false);
  const [endpoint, setEndpoint] = useState(undefined);
  const trend = useMemo(() => getTrend(category, endpoint), [getTrend, category, endpoint]);
  const months = trend.availableMonths;
  const first = months.indexOf(trend.rows[0]?.month);
  const last = months.indexOf(trend.rows.at(-1)?.month);
  const currentMonth = currentCalendarMonth();
  const id = `budget-comparison-${category ? encodeURIComponent(category) : "total"}`;
  return <section className={`budget-comparison ${expanded ? "is-expanded" : ""}`} aria-label={`${category || "Total budget"} monthly comparison`}>
    <div className="budget-comparison-heading"><h2>{category ? "Category history" : "Monthly progress"}</h2><button className="budget-text-button" aria-expanded={expanded} aria-controls={id} onClick={() => { setExpanded(!expanded); setEndpoint(undefined); }}>{expanded ? "Collapse comparison" : "Expand comparison"}</button></div>
    <div id={id}>
      {expanded && <div className="budget-history-controls"><button disabled={first <= 0} onClick={() => setEndpoint(months[first - 1])}>Previous months</button><span>{trend.rows.length ? `${formatMonth(trend.rows[0].month)} – ${formatMonth(trend.rows.at(-1).month)}` : "No history"}</span><button disabled={last >= months.length - 1} onClick={() => setEndpoint(months[Math.min(months.length - 1, last + 6)])}>Next months</button></div>}
      <div className="budget-comparison-chart">{trend.rows.map((row) => {
        const reported = trend.reportedMonths.includes(row.month);
        const note = !reported ? "No data" : row.month === currentMonth ? "Partial" : row.month > currentMonth ? "Planned" : "";
        return <a key={row.month} className={`budget-month-bar ${row.isSelected ? "selected" : ""}`} href={trendHref("budget", row.month, null, trend.basis)} aria-current={row.isSelected ? "true" : undefined} aria-label={`${formatMonth(row.month)}: ${reported ? `${money(row.actual)} spent, ${row.hasGoal ? money(row.goal) + " budget" : "no budget"}` : "No data"}${note ? `, ${note}` : ""}`}>
          <span className="budget-month-label">{row.label} {row.year}{note && <small>{note}</small>}</span>
          <span className="budget-chart-track" aria-hidden="true">{reported && <><i style={{ width: `${Math.min(100, row.goal / trend.scaleMax * 100)}%` }} /><b className={row.actual > row.goal && row.hasGoal ? "is-over" : ""} style={{ width: `${Math.max(row.actual > 0 ? 2 : 0, row.actual / trend.scaleMax * 100)}%` }} /></>}</span>
          <span className="budget-month-values"><strong>{reported ? money(row.actual) : "No data"}</strong>{expanded && <small>{row.hasGoal ? `${money(row.goal)} budget` : "No budget"}</small>}</span>
        </a>;
      })}</div>
      <p className="budget-chart-caption">Spending against budget · {trend.basis === "installments" ? "Monthly allocations may include estimates" : "Full purchase cost"}</p>
    </div>
  </section>;
}

function Status({ row }) { return <span className={`status-pill ${row.statusKey}`}><i />{row.status}</span>; }

function trendHref(view, month, category, basis = "purchase") {
  if (view === "budget") return `#budget?month=${month}&basis=${basis}&report=monthly`;
  return `#activity?month=${month}&basis=${basis}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
}

function BudgetTrend({ trend, view = "activity" }) {
  if (!trend?.rows?.length) return <p className="soft-copy budget-trend-empty">No monthly budget history is available yet.</p>;
  return <section className="category-trend" aria-label={`${trend.category || "Total budget"} six month actual versus plan comparison`}>
    <div className="category-trend-head"><span>Last 6 months</span><em>Actual vs plan</em></div>
    <div className="category-trend-list">
      {trend.rows.map((row) => {
        const actualWidth = Math.max(row.actual > 0 ? 3 : 0, Math.min(100, (Math.max(0, row.actual) / trend.scaleMax) * 100));
        const goalWidth = Math.max(row.goal > 0 ? 3 : 0, Math.min(100, (row.goal / trend.scaleMax) * 100));
        const comparison = row.hasGoal ? `${row.percent}% of ${money(row.goal)}` : "No plan";
        return <a
          className={`category-trend-row ${row.statusKey} ${row.isSelected ? "active" : ""}`}
          href={trendHref(view, row.month, trend.category, trend.basis)}
          aria-current={row.isSelected ? "true" : undefined}
          aria-label={`${row.label} 20${row.year}: ${money(row.actual)} actual, ${row.hasGoal ? `${money(row.goal)} planned, ${row.percent} percent of plan` : "no plan"}`}
          key={row.month}
        >
          <span className="trend-month">{row.label}<small>{row.year}</small></span>
          <span className="trend-bars" aria-hidden="true"><i className="trend-plan" style={{ width: `${goalWidth}%` }} /><b className="trend-actual" style={{ width: `${actualWidth}%` }} /></span>
          <span className="trend-values"><strong>{money(row.actual)}</strong><small>{comparison}</small></span>
        </a>;
      })}
    </div>
  </section>;
}

function BudgetPlanCard({ plan, month, category, trend }) {
  const hasGoal = category ? Boolean(plan?.hasGoal) : number(plan?.goal) > 0;
  const goal = number(plan?.goal);
  const actual = number(plan?.actual);
  const remaining = goal - actual;
  const title = category ? `${category} budget plan` : "Total budget plan";
  const note = hasGoal
    ? category
      ? `${category} was planned as ${money(goal)} for ${formatMonth(month)}. Actual spending is ${money(actual)}, leaving ${money(Math.abs(remaining))} ${remaining < 0 ? "over" : "against"} the plan.`
      : `Across all budget categories, the plan for ${formatMonth(month)} is ${money(goal)}. Actual spending is ${money(actual)}, leaving ${money(Math.abs(remaining))} ${remaining < 0 ? "over" : "against"} the plan.`
    : `${money(actual)} was recorded${category ? ` for ${category}` : ""} without a monthly budget goal.`;
  const status = plan || { status: "No goal", statusKey: "unbudgeted" };

  return <section className="budget-plan-note compact-plan" aria-labelledby="activityBudgetPlanTitle">
    <div className="panel-head"><div><h2 id="activityBudgetPlanTitle">{title}</h2><p className="soft-copy">{note}</p></div><Status row={status} /></div>
    <div className="plan-metrics" aria-label="Budget plan metrics">
      <article><span>Planned</span><strong>{hasGoal ? money(goal) : "No goal"}</strong></article>
      <article><span>Actual</span><strong>{money(actual)}</strong></article>
      <article><span>{remaining < 0 ? "Over" : "Remaining"}</span><strong className={remaining < 0 ? "negative" : "positive"}>{hasGoal ? money(Math.abs(remaining)) : "—"}</strong></article>
    </div>
    <BudgetTrend trend={trend} />
  </section>;
}

function BudgetPeriodCategories({ rows, screen, periodLabel }) {
  const [expandedCategory, setExpandedCategory] = useState(rows[0]?.category || null);
  const monthlyByCategory = new Map(screen.budgetRows.map((row) => [row.category, row]));
  return <section className="budget-category-report budget-period-category-report" aria-label={`${periodLabel} categories`}>
    <div className="budget-column-labels" aria-hidden="true"><span>Category</span><span>Spent / Monthly budget</span><span>Month left / over</span></div>
    <ul className="budget-category-list">{rows.map((row, index) => {
      const monthly = monthlyByCategory.get(row.category);
      const goal = monthly?.goal || 0;
      const percent = goal > 0 ? Math.round(row.totalRaw / goal * 100) : 0;
      const open = expandedCategory === row.category;
      const remaining = monthly?.hasGoal ? `${money(Math.abs(monthly.remaining))} ${monthly.remaining < 0 ? "over" : "left"}` : "No budget";
      return <li key={row.category}>
        <button className={`budget-category-toggle ${open ? "is-open" : ""}`} aria-expanded={open} aria-controls={`period-category-detail-${index}`} onClick={() => setExpandedCategory(open ? null : row.category)}>
          <span className="budget-category-name"><span className="category-icon"><Icon name={categoryIcon(row.category)} /></span><span><strong>{row.category}</strong><small>{row.count} transaction{row.count === 1 ? "" : "s"}</small></span></span>
          <span className="budget-category-spent"><span><strong>{money(row.totalRaw)}</strong><small> / {monthly?.hasGoal ? monthly.goalLabel : "No budget"}</small></span>{goal > 0 && <span className="budget-utilization" role="progressbar" aria-label={`${row.category} monthly budget used in ${periodLabel}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, percent))} aria-valuetext={`${percent}% spent in ${periodLabel}`}><i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></span>}</span>
          <span className={`budget-category-balance ${monthly?.remaining < 0 ? "negative" : ""}`}>{remaining}<Icon name="chevron" /></span>
        </button>
        {open && <div className="budget-inline-detail" id={`period-category-detail-${index}`}><div className="budget-detail-heading"><h3>{row.category} transactions</h3><span>{row.count} in {periodLabel}</span></div><TransactionList rows={decorateTransactions(row.transactions)} showCard metaFor={(tx) => tx.allocationEstimated ? <span className="budget-coverage-label">Estimated installment allocation</span> : tx.allocationWarning ? <span className="budget-review-label">Needs installment review</span> : null} /></div>}
      </li>;
    })}</ul>
    <p className="table-note">All amounts in {CURRENCY}</p>
  </section>;
}

function Weekly({ screen, month, route }) {
  const weeks = screen.weeklyReport.weeks;
  const selectedStart = route.params.get("week") || screen.weeklyReport.activeWeekStart;
  const selected = weeks.find((week) => week.start === selectedStart) || weeks[0];
  return <section className="panel weekly-report-panel"><div className="panel-head"><div><h2>Weekly spending</h2><p className="soft-copy">See which categories drove spending in the selected week.</p></div><span className="transaction-count">{selected?.total || money(0)} · {selected?.count || 0} tx</span></div><div className="week-tabs">{weeks.map((week) => <a className={`week-tab ${week.start === selected?.start ? "active" : ""}`} href={`#budget?month=${month}&basis=${screen.budgetBasis}&report=weekly&week=${week.start}`} key={week.start}><span>{week.label}</span><strong>{week.total}</strong></a>)}</div>{selected?.categories.length ? <BudgetPeriodCategories key={selected.start} rows={selected.categories} screen={screen} periodLabel={selected.label} /> : <p className="soft-copy">No category spending in this week.</p>}</section>;
}

function Daily({ screen, month, route }) {
  const { days, defaultDate } = screen.dailyReport;
  const requestedDate = route.params.get("day");
  const selected = days.find((day) => day.date === requestedDate) || days.find((day) => day.date === defaultDate);
  const selectedBar = useRef(null);
  useEffect(() => {
    const centerSelectedDay = () => {
      const bar = selectedBar.current;
      const scroller = bar?.closest(".daily-chart-scroll");
      if (bar && scroller) {
        const left = bar.offsetLeft - scroller.clientWidth / 2 + bar.clientWidth / 2;
        scroller.scrollLeft = Math.max(0, left);
      }
    };
    centerSelectedDay();
    window.addEventListener("resize", centerSelectedDay);
    return () => window.removeEventListener("resize", centerSelectedDay);
  }, [selected?.date]);
  const goal = screen.budgetTotal.goal;
  const scale = Math.max(1, goal, ...days.map((day) => Math.max(0, day.cumulativeRaw)));
  const dateLabel = selected && new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "short", day: "numeric"
  }).format(new Date(`${selected.date}T12:00:00`));
  return <section className="panel daily-report-panel" aria-labelledby="dailyReportTitle">
    <div className="daily-report-head"><div><h2 id="dailyReportTitle">Cumulative spending</h2><p className="soft-copy">Select a day to see what changed in {formatMonth(month)}.</p></div>{days.length > 0 && <strong>{money(days.at(-1).cumulativeRaw)} <small>spent through {monthShortDayFromDate(days.at(-1).date)}</small></strong>}</div>
    {days.length ? <>
      <div className="daily-chart-scroll" aria-label={`Daily budget spending for ${formatMonth(month)}`}>
        <div className="daily-chart" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="daily-chart-plot" aria-hidden="true">{goal > 0 && <span className="daily-goal-line" style={{ bottom: `${goal / scale * 100}%` }}><span>Goal {money(goal)}</span></span>}</div>
          {days.map((day) => <a key={day.date} ref={day.date === selected?.date ? selectedBar : null}
            className={`daily-chart-day ${day.date === selected?.date ? "is-selected" : ""}`}
            href={`#budget?month=${month}&basis=${screen.budgetBasis}&report=daily&day=${day.date}`}
            aria-current={day.date === selected?.date ? "date" : undefined}
            aria-label={`${monthShortDayFromDate(day.date)}: ${money(day.cumulativeRaw)} spent so far, ${money(day.dailyRaw)} on this day, ${day.count} transaction${day.count === 1 ? "" : "s"}`}>
            <span className="daily-bar-area" aria-hidden="true"><span className="daily-bar" style={{ height: `${Math.max(day.cumulativeRaw > 0 ? 2 : 0, Math.max(0, day.cumulativeRaw) / scale * 100)}%` }} /></span>
            <span className="daily-day-label">{day.day}</span>
          </a>)}
        </div>
      </div>
      <div className="daily-detail" aria-live="polite">
        <div className="daily-detail-head"><h3>{dateLabel}</h3><div><span><small>Month total</small><strong>{money(selected.cumulativeRaw)}</strong></span><span><small>{selected.dailyRaw < 0 ? "Reduced this day" : "Added this day"}</small><strong>{money(Math.abs(selected.dailyRaw))}</strong></span><span><small>Transactions</small><strong>{selected.count}</strong></span></div></div>
        {selected.categories.length ? <BudgetPeriodCategories key={selected.date} rows={selected.categories} screen={screen} periodLabel={dateLabel} /> : <p className="daily-empty-day">No budget transactions on this day. Month spending stayed at {money(selected.cumulativeRaw)}.</p>}
      </div>
    </> : <p className="daily-empty-day">This month has not started yet. Choose a current or past month to review daily spending.</p>}
  </section>;
}

function Income({ screen, month, onMonth }) {
  const report = screen.incomeReport;
  return <section className="view active" data-screen="income"><ScreenHeader title="Income Breakdown" copy="See incoming money by salaries and other sources." screen={screen} month={month} onMonth={onMonth} /><section className="income-summary"><Metric label="Total incoming" value={report.totalLabel} detail={report.salaryShareLabel} icon="down" /><Metric label="Salaries" value={report.salaryTotalLabel} detail={`${report.categories[0]?.count || 0} records`} icon="users" /><Metric label="Other incoming" value={report.otherTotalLabel} detail={`${report.categories[1]?.count || 0} records`} icon="receipt" tone="blue" /></section><div className="income-report-grid"><section className="panel"><h2>Breakdown</h2><div className="income-breakdown-list">{report.categories.map((item) => <article className="income-breakdown-row" key={item.key}><span className={`category-icon ${item.key === "salary" ? "ok" : "blue"}`}><Icon name={item.key === "salary" ? "users" : "down"} /></span><div><strong>{item.label}</strong><small>{item.count} incoming records</small></div><b>{item.amountLabel}</b><span className="income-bar"><i style={{ width: `${Math.round(item.share * 100)}%` }} /></span></article>)}</div></section><section className="panel wide"><div className="panel-head"><div><h2>Incoming transactions</h2><p className="soft-copy">Salaries, expected income, and other incoming records.</p></div><span className="transaction-count">{report.rows.length} records</span></div><div className="transaction-list">{report.rows.map((row) => <article className="transaction-row income-row" key={row.id}><span className={`category-icon ${row.kind === "salary" ? "ok" : "blue"}`}><Icon name={row.kind === "salary" ? "users" : "down"} /></span><div><strong>{row.source}</strong><small>{row.kindLabel} · {row.detail}</small></div><time>{row.dateLabel}</time><span className="status-pill ok"><i />{row.status}</span><b>+{row.amountLabel}</b></article>)}</div></section></div></section>;
}

function BudgetBasisToggle({ basis, onChange }) {
  return <div className="date-basis-toggle" role="group" aria-label="Budget cost mode">
    <button aria-pressed={basis === "purchase"} className={basis === "purchase" ? "active" : ""} onClick={() => onChange("purchase")}>Full purchase cost</button>
    <button aria-pressed={basis === "installments"} className={basis === "installments" ? "active" : ""} onClick={() => onChange("installments")}>Monthly installments</button>
  </div>;
}

function DateBasisToggle({ basis, onChange }) {
  return <div className="date-basis-toggle" role="group" aria-label="Activity date basis">
    <button className={basis === "purchase" ? "active" : ""} type="button" onClick={() => onChange("purchase")}>Purchase month</button>
    <button className={basis === "installments" ? "active" : ""} type="button" onClick={() => onChange("installments")}>Monthly installments</button>
    <button className={basis === "billing" ? "active" : ""} type="button" onClick={() => onChange("billing")}>Billing month</button>
  </div>;
}

function Commitments({ screen, month, onMonth }) {
  const report = screen.commitments;
  return <section className="view active commitments-view" data-screen="commitments">
    <ScreenHeader title="Cash-flow Commitments" copy="Actual billing dates. Supported future installment estimates are listed separately." screen={screen} month={month} onMonth={onMonth}><MonthSelect month={month} months={screen.commitmentMonths} onChange={onMonth} /></ScreenHeader>
    <section className="income-summary commitments-summary"><Metric label="Total due" value={report.totalLabel} detail="Statement-backed card charges" icon="calendar" tone="watch" /><Metric label="Card charges" value={String(report.count)} detail={`${report.byCard.length} card statement${report.byCard.length === 1 ? "" : "s"}`} icon="receipt" /><Metric label="Categories" value={String(report.byCategory.length)} detail="Cash timing only" icon="pie" tone="blue" /></section>
    <div className="income-report-grid">
      <section className="panel"><h2>By card</h2><div className="income-breakdown-list">{report.byCard.length ? report.byCard.map((item) => <article className="income-breakdown-row" key={item.card}><span className="category-icon blue"><Icon name="bank" /></span><div><strong>{item.card.replace(/^card-/i, "Card ")}</strong><small>{item.count} billed charge{item.count === 1 ? "" : "s"}</small></div><b>{money(item.total)}</b></article>) : <p className="soft-copy">No card commitments in this imported statement month.</p>}</div></section>
      <section className="panel"><h2>By category</h2><div className="income-breakdown-list">{report.byCategory.length ? report.byCategory.map((item) => <article className="income-breakdown-row" key={item.category}><span className="category-icon ok"><Icon name={categoryIcon(item.category)} /></span><div><strong>{item.category}</strong><small>{item.count} billed charge{item.count === 1 ? "" : "s"}</small></div><b>{money(item.total)}</b></article>) : <p className="soft-copy">No card commitments in this imported statement month.</p>}</div></section>
    </div>
    <section className="panel activity-transactions"><div className="panel-head"><div><h2>Statement-backed charges</h2><p className="soft-copy">Each item shows its purchase date and the date it is billed.</p></div><span className="transaction-count">{report.count} charges</span></div>{screen.commitmentRows.length ? <TransactionList rows={screen.commitmentRows} showCard /> : <p className="soft-copy activity-empty">No card charges were imported for this billing month.</p>}</section>
    {screen.projectedCommitmentRows.length > 0 && <section className="panel"><h2>Projected installments — not yet on a statement</h2><p className="soft-copy">These estimates are excluded from the actual total above.</p><TransactionList rows={screen.projectedCommitmentRows} showCard /></section>}
  </section>;
}

function Activity({ screen, month, onMonth, route, trend }) {
  const [search, setSearch] = useState(() => route.params.get("q") || "");
  const basis = ["billing", "installments"].includes(route.params.get("basis")) ? route.params.get("basis") : "purchase";
  const category = route.params.get("category");
  const weekStart = route.params.get("week");
  const week = screen.weeklyReport.weeks.find((item) => item.start === weekStart);
  const normalizedSearch = search.trim().toLowerCase();
  const sourceRows = basis === "billing" ? screen.allTransactions : screen.purchaseTransactions;
  const rows = sourceRows.filter((tx) => {
    const matchesContext = (!category || tx.category === category) && (!week || (tx.date >= week.start && tx.date <= week.end));
    const haystack = [normalizedMerchantName(tx), tx.category, tx.date, tx.description].filter(Boolean).join(" ").toLowerCase();
    return matchesContext && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const plan = category ? screen.budgetRows.find((row) => row.category === category) : screen.budgetTotal;
  const latestImport = screen.importRuns[0];
  const setBasis = (nextBasis) => setRoute("activity", { month, category, week: weekStart, basis: nextBasis, q: search });
  function changeSearch(value) {
    setSearch(value);
    const params = new URLSearchParams(route.params);
    value ? params.set("q", value) : params.delete("q");
    window.history.replaceState(null, "", `#activity${params.size ? `?${params}` : ""}`);
  }
  return <section className="view active" data-screen="activity">
    <ScreenHeader title="Activity" copy={basis === "installments" ? "Budget portions spread consecutively from purchase month." : basis === "purchase" ? "Purchases are shown when your household made them." : "Card charges are shown when billed; bank items stay on their posted date."} screen={screen} month={month} onMonth={onMonth}><div className="screen-header-controls"><DateBasisToggle basis={basis} onChange={setBasis} /><MonthSelect month={month} months={basis === "billing" ? screen.billingAvailableMonths : screen.budgetAvailableMonths} onChange={onMonth} /></div></ScreenHeader>
    <section className="activity-command-bar" aria-label="Activity controls">
      <label className="activity-search"><span className="sr-only">Search transactions</span><input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search merchant or category" /></label>
      <details className="activity-data-status"><summary><span className="status-dot" />Data {readableImportTime(latestImport?.importedAt || latestImport?.createdAt).toLowerCase()}<span className="icon"><Icon name="chevron" /></span></summary><div className="maintenance-list">{screen.importRuns.slice(0, 3).map((run) => <div key={run.id}><strong>{run.label || run.source || "Ledger import"}</strong><span>{readableImportTime(run.importedAt || run.createdAt)}</span></div>)}</div></details>
    </section>
    {basis !== "billing" && <BudgetPlanCard plan={plan} month={month} category={category} trend={trend} />}
    <section className="panel activity-transactions"><div className="panel-head"><div><h2>{category ? category : basis === "purchase" ? "All purchases" : basis === "installments" ? "Monthly budget allocations" : "All billed transactions"}</h2>{(category || week) && <a className="text-link compact-link" href={`#activity?month=${month}&basis=${basis}`}>Clear filters</a>}</div><span className="transaction-count">{rows.length} transactions</span></div>{rows.length ? <TransactionList rows={rows} /> : <p className="soft-copy activity-empty">No transactions match this search.</p>}</section>
  </section>;
}

function InstallmentDetails({ tx }) {
  if (!tx.isInstallment || tx.amount < 0) return null;
  const plan = tx.installmentPlan;
  return <div className="installment-info">
    <span className="installment-badge">{plan?.kind === "credit" ? "Credit installment · statement payment" : tx.purchaseEvent ? "Installment purchase" : tx.installmentCount ? `Portion ${tx.installmentNumber || "?"} of ${tx.installmentCount}${plan?.scheduleInferred ? " · Inferred schedule" : ""}` : "Installment · count not stated"}</span>
    <small>Purchase total {money(plan?.purchaseAmount || tx.purchaseAmount || tx.amount)}{tx.timingBasis === "installments" ? ` · Allocated ${formatMonth(tx.date.slice(0, 7))}` : ""}{tx.allocationEstimated ? " · Estimated portion" : ""}</small>
    {plan?.inferenceNote && <small>{plan.inferenceNote}. Statement amounts replace estimates as imports arrive.</small>}
    {plan?.categoryNote && <small>{plan.categoryNote}.</small>}
    {(tx.allocationWarning || plan?.warning) && <p className="allocation-warning">{tx.allocationWarning || plan.warning}. {tx.purchaseEvent ? "Full purchase principal is counted once." : "These payments remain in their billing months; no unconfirmed future payments are added."}</p>}
    {plan?.schedule?.length > 0 && <details className="installment-schedule"><summary>View {plan.installmentCount}-portion schedule</summary><ol>{plan.schedule.map((portion) => <li key={portion.id}><span>#{portion.number} · {formatMonth(portion.date.slice(0, 7))}<small>{portion.billingDate ? `Billed ${portion.billingDate}` : portion.projectedBillingDate ? `Expected billing ${portion.projectedBillingDate}` : "Billing date unavailable"}{portion.estimated ? " · Estimated" : " · Statement amount"}</small></span><b>{money(portion.amount)}</b></li>)}</ol></details>}
  </div>;
}

function TransactionList({ rows, showCard = false, metaFor, merchantLinks = true, fullDates = false }) {
  return <div className="transaction-list">{rows.map((tx) => {
    const card = String(tx.account_id || tx.accountId || tx.card || "").replace(/^card-/i, "Card ");
    const installmentTiming = tx.isInstallment && tx.billingDate
      ? ` · Purchased ${monthShortDayFromDate(tx.purchaseDate || tx.date)} · Billed ${monthShortDayFromDate(tx.billingDate)}`
      : tx.purchaseDate && tx.purchaseDate !== tx.date
        ? ` · Purchased ${monthShortDayFromDate(tx.purchaseDate || tx.date)}`
        : "";
    return <article className="transaction-row" key={`${tx.id}-${tx.date}`}><span className={`category-icon ${isBudgetExpense(tx) ? "ok" : "blue"}`}><Icon name={isBudgetExpense(tx) ? categoryIcon(tx.category) : "down"} /></span><div><span className="merchant-name-line"><strong>{merchantLinks && (isBudgetExpense(tx) || tx.type === "refund") ? <a className="merchant-report-link" href={merchantReportHref(tx, typeof window === "undefined" ? "#activity" : window.location.hash)} aria-label={`View ${normalizedMerchantName(tx)} merchant report`} dir="auto">{normalizedMerchantName(tx)}</a> : <span dir="auto">{normalizedMerchantName(tx)}</span>}</strong><button className="summary-help merchant-help" type="button" aria-label={`${normalizedMerchantName(tx)}: ${merchantDescription(tx)}`}><span className="icon"><Icon name="help" /></span><span className="summary-tooltip" role="tooltip">{merchantDescription(tx)}</span></button></span><small>{tx.category || "Other"}{showCard && card ? ` · ${card}` : ""}{installmentTiming}</small>{metaFor && <small className="budget-transaction-meta">{metaFor(tx)}</small>}<InstallmentDetails tx={tx} />{tx.monthlyTotal && <details className="transaction-month-total"><summary>{tx.monthlyTotal.label}</summary><div className="month-total-breakdown">{tx.monthlyTotal.items.map((item, index) => <span className="month-total-item" key={`${item.date}-${item.amount}-${index}`}><span>{item.date}</span><strong>{item.amount}</strong></span>)}</div></details>}</div><time dateTime={tx.date}>{fullDates ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${tx.date}T00:00:00`)) : monthShortDayFromDate(tx.date)}</time><b>{tx.direction === "inflow" ? "+" : ""}{money(tx.direction === "inflow" ? Math.abs(tx.amount) : tx.amount)}</b></article>;
  })}</div>;
}

function Settings({ state, originalState, ledger, sharedState, screen, month, onMonth, onSharedState, onRefresh, getTrend, isOwner, user }) {
  const [message, setMessage] = useState({ text: "", tone: "" });
  const [settings, setSettings] = useState({ currency: state.currency || CURRENCY, openingBalance: state.openingBalance || 0, bufferTarget: state.bufferTarget || 0 });
  const [section, setSection] = useState(() => {
    const panel = routeFromHash().params.get("panel");
    return panel === "travel-cash" ? "cash" : ["money", "cash", "budgets", "household", "data"].includes(panel) ? panel : "money";
  });
  const travelPanel = useRef(null);
  useEffect(() => setSettings({ currency: state.currency || CURRENCY, openingBalance: state.openingBalance || 0, bufferTarget: state.bufferTarget || 0 }), [state.currency, state.openingBalance, state.bufferTarget]);
  useEffect(() => {
    const updatePanel = () => {
      const panel = routeFromHash().params.get("panel");
      if (panel === "travel-cash") {
        setSection("cash");
        travelPanel.current?.scrollIntoView({ behavior: "smooth" });
      } else if (["money", "cash", "budgets", "household", "data"].includes(panel)) setSection(panel);
    };
    updatePanel();
    window.addEventListener("hashchange", updatePanel);
    return () => window.removeEventListener("hashchange", updatePanel);
  }, []);
  async function run(action, success) {
    setMessage({ text: "Saving…", tone: "" });
    try { const result = await action(); if (result.sharedState) onSharedState(result.sharedState); setMessage({ text: success, tone: "success" }); }
    catch (error) { setMessage({ text: error.message, tone: "error" }); }
  }
  const entries = sharedState.travelCashEntries || [];
  const sections = [
    ["money", "Money"],
    ["cash", "Cash reports"],
    ["budgets", "Budgets"],
    ["household", "Household"],
    ["data", "Data & backup"]
  ];
  return <section className="view active" data-screen="settings">
    <ScreenHeader title="Settings" copy="Manage one part of the household workspace at a time." screen={screen} month={month} onMonth={onMonth}><div className="account-actions"><span className="plan-badge">Personal account</span><a className="secondary-btn" href="#settings?panel=data">Local workspace</a></div></ScreenHeader>
    <div className="settings-workspace">
      <nav className="settings-section-nav" aria-label="Settings sections">{sections.map(([key, label]) => <button className={section === key ? "active" : ""} type="button" onClick={() => { setSection(key); setRoute("settings", { panel: key, month }); }} aria-current={section === key ? "page" : undefined} key={key}>{label}<span className="icon"><Icon name="arrow" /></span></button>)}</nav>
      <div className="settings-section-content">
        {section === "money" && <section className="panel"><h2>Money settings</h2><p className="soft-copy">Defaults used across the shared household workspace and safe-to-spend guardrail.</p><div className="settings-fields"><label className="field"><span>Currency</span><input value={settings.currency} readOnly /><small>Set the base currency before importing in config/household.json.</small></label><label className="field"><span>Opening balance</span><input type="number" value={settings.openingBalance} onChange={(event) => setSettings({ ...settings, openingBalance: event.target.value })} /></label><label className="field"><span>Comfort buffer</span><input type="number" min="0" step="1" value={settings.bufferTarget} onChange={(event) => setSettings({ ...settings, bufferTarget: event.target.value })} /><small>Safe-to-spend will protect this amount.</small></label></div><button className="primary-btn" onClick={() => run(() => saveSharedSettings({ ...settings, openingBalance: number(settings.openingBalance), bufferTarget: number(settings.bufferTarget) }), "Money settings saved for the household.")}>Save money settings</button></section>}
        {section === "cash" && <CashReports entries={entries} panelRef={travelPanel} onChange={onSharedState} onMessage={setMessage} />}
        {section === "budgets" && <BudgetPlanEditor plan={screen.budgetPlan} state={originalState} ledger={ledger} sharedState={sharedState} month={month} months={screen.budgetAvailableMonths} onMonth={onMonth} onChange={onSharedState} getTrend={getTrend} />}
        {section === "household" && <><section className="panel"><h2>Personal account</h2><p className="soft-copy">This dashboard is available to trusted users of this computer. Run the local sync after validated imports. Remote sharing and multi-user login are outside this local release.</p><span className="plan-badge">{user.displayName || user.email}</span></section></>}
        {section === "data" && <><BackupPanel onChange={onSharedState} onMessage={setMessage} onRefresh={onRefresh} />{isOwner && <details className="panel recovery-panel"><summary>Owner ledger recovery</summary><p className="soft-copy">Normal ledger updates happen automatically after transaction integrity checks. Use this only to recover from a missing active snapshot.</p><ImportPanel onComplete={onRefresh} /></details>}</>}
        <p className={`save-state ${message.tone}`} role="status">{message.text}</p>
      </div>
    </div>
  </section>;
}

function CashReports({ entries, panelRef, onChange, onMessage }) {
  const [form, setForm] = useState({ type: "spent", currency: CURRENCY, amount: "", category: "Dining", date: new Date().toISOString().slice(0, 10), note: "" });
  const rate = { rate: 1, label: `1 ${CURRENCY} = 1 ${CURRENCY}` };
  const baseValue = number(form.amount);
  async function submit(event) { event.preventDefault(); onMessage({ text: "Saving cash report…", tone: "" }); try { const result = await addCashReport({ ...form, amount: Number(form.amount) }); onChange(result.sharedState); setForm({ ...form, amount: "", note: "" }); onMessage({ text: "Cash report added to the shared household ledger.", tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } }
  async function remove(id) { onMessage({ text: "Deleting cash report…", tone: "" }); try { const result = await deleteCashReport(id); onChange(result.sharedState); onMessage({ text: "Cash report deleted.", tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } }
  const spent = sum(entries.filter((entry) => entry.type !== "saved"), (entry) => entry.nisValue);
  const saved = sum(entries.filter((entry) => entry.type === "saved"), (entry) => entry.nisValue);
  return <section className="panel" ref={panelRef}><div className="panel-head split"><div><h2>Cash report</h2><p className="soft-copy">Report cash spent or saved in the household base currency. Automatic currency conversion is not supported.</p></div><span className="transaction-count">{money(spent)} spent{saved ? ` · ${money(saved)} saved` : ""}</span></div><form className="travel-cash-form" onSubmit={submit}>{[["Type", "type", <><option value="spent">Spent cash</option><option value="saved">Saved cash</option></>], ["Currency", "currency", [CURRENCY].map((key) => <option value={key} key={key}>{key}</option>)], ["Category", "category", ["Dining", "Family", "Travel", "Shopping", "Transport", "Cash", "Other", "Groceries"].map((key) => <option value={key} key={key}>{key}</option>)]].map(([label, key, options]) => <label className="field" key={key}><span>{label}</span><select value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}>{options}</select></label>)}<label className="field"><span>Cash amount</span><input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><label className="field"><span>Date</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label><label className="field"><span>Note</span><input type="text" maxLength="80" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Wallet, ATM, exchange" /></label><div className="travel-cash-preview"><span>{form.type === "spent" ? "Spend" : "Save"} · {rate.label}</span><strong>{money(baseValue)}</strong></div><button className="primary-btn" type="submit"><span className="icon"><Icon name="cash" /></span>Add report</button></form><div className="travel-cash-list">{entries.map((entry) => <article className={`travel-cash-row is-${entry.type}`} key={entry.id}><span className={`category-icon ${entry.type === "saved" ? "ok" : "watch"}`}><Icon name={categoryIcon(entry.category)} /></span><div><strong>{entry.note || `${entry.amount} ${entry.currency}`}</strong><small>{entry.category} · {entry.amount.toLocaleString()} {entry.currency} · {entry.rateLabel}</small></div><time>{monthShortDayFromDate(entry.date)}</time><b>{entry.type === "saved" ? "+" : "-"}{money(entry.nisValue)}</b><button className="icon-btn" type="button" onClick={() => remove(entry.id)} aria-label="Delete cash report"><Icon name="close" /></button></article>)}</div></section>;
}

function BudgetSettings({ state, originalState, sharedState, plan, month, months, onMonth, onChange, onMessage }) {
  const requested = routeFromHash().params.get("subpanel");
  const subpanel = requested === "recurring" ? "recurring" : "categories";
  return <>
    <section className="panel budget-settings-navigation">
      <div><h2>Budget settings</h2><p className="soft-copy">Manage monthly category goals and the recurring costs they must cover.</p></div>
      <MonthSelect month={month} months={months} onChange={onMonth} className="budget-editor-month" />
      <nav className="budget-settings-tabs" aria-label="Budget settings type">
        <a className={subpanel === "categories" ? "active" : ""} aria-current={subpanel === "categories" ? "page" : undefined} href={`#settings?panel=budgets&subpanel=categories&month=${month}`}>Category budgets</a>
        <a className={subpanel === "recurring" ? "active" : ""} aria-current={subpanel === "recurring" ? "page" : undefined} href={`#settings?panel=budgets&subpanel=recurring&month=${month}`}>Recurring costs</a>
      </nav>
    </section>
    {subpanel === "recurring"
      ? <RecurringCostEditor plan={plan} month={month} onSharedState={onChange} />
      : <BudgetEditor state={state} originalState={originalState} sharedState={sharedState} month={month} onChange={onChange} onMessage={onMessage} />}
  </>;
}

function BudgetEditor({ state, originalState, sharedState, month, onChange, onMessage }) {
  const [values, setValues] = useState({});
  const [types, setTypes] = useState({});
  useEffect(() => {
    setValues(Object.fromEntries((state.categories || []).map((category) => [category.name, Math.round(number(category.budget))])));
    setTypes(Object.fromEntries((state.categories || []).map((category) => [category.name, category.spendingType || "committed"])));
  }, [month, sharedState]);
  async function save(event) { event.preventDefault(); const imported = Object.fromEntries((originalState.categories || []).map((category) => [category.name, Math.round(number(category.budget))])); const overrides = Object.fromEntries(Object.entries(values).filter(([category, value]) => number(value) !== number(imported[category])).map(([category, value]) => [category, number(value)])); onMessage({ text: "Saving budget guardrails…", tone: "" }); try { await saveBudgetOverrides(month, overrides); const result = await saveCategorySettings(types); onChange(result.sharedState); onMessage({ text: `Budget and spending types saved for ${formatMonth(month)}.`, tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } }
  async function reset() { onMessage({ text: "Resetting monthly budget…", tone: "" }); try { const result = await resetBudgetOverrides(month); onChange(result.sharedState); onMessage({ text: `Imported goals restored for ${formatMonth(month)}.`, tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } }
  const active = sharedState.budgetOverridesByMonth?.[month] || {};
  return <section className="panel"><h2>Category budgets</h2><p className="soft-copy">Set monthly goals and identify costs that must be covered before flexible spending. Spending type applies to every month.</p><div className="budget-type-guide"><span><i className="committed" />Committed: bills and required costs</span><span><i className="flexible" />Flexible: daily spending you can adjust</span></div><form className="budget-editor" onSubmit={save}><div className="budget-edit-list">{(state.categories || []).map((category) => <div className={`budget-edit-row ${Object.prototype.hasOwnProperty.call(active, category.name) ? "is-edited" : ""}`} key={category.name}><span><strong>{category.name}</strong><small>{Object.prototype.hasOwnProperty.call(active, category.name) ? `Edited for ${formatMonth(month)}` : "Monthly goal"}</small></span><label className="budget-type-select"><span className="sr-only">{category.name} spending type</span><select value={types[category.name] || "committed"} onChange={(event) => setTypes({ ...types, [category.name]: event.target.value })}><option value="committed">Committed</option><option value="flexible">Flexible</option></select></label><label><span className="sr-only">{category.name} monthly budget</span><input className="budget-edit-input" type="number" min="0" step="1" value={values[category.name] ?? 0} onChange={(event) => setValues({ ...values, [category.name]: event.target.value })} /></label></div>)}</div><div className="budget-editor-actions"><button className="primary-btn" type="submit">Save budget guardrails</button><button className="secondary-btn" type="button" onClick={reset}>Reset amounts to import</button></div></form></section>;
}

function BackupPanel({ onChange, onMessage, onRefresh }) {
  async function exportBackup() { try { const backup = await downloadSharedBackup(); const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `cashflow-repair-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); onMessage({ text: "Shared household backup exported.", tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } }
  async function importFile(event) { const file = event.target.files?.[0]; if (!file) return; onMessage({ text: "Importing shared household backup…", tone: "" }); try { const result = await importSharedBackup(JSON.parse(await file.text())); onChange(result.sharedState); onMessage({ text: "Backup imported. The synchronized ledger was not changed.", tone: "success" }); } catch (error) { onMessage({ text: error.message, tone: "error" }); } event.target.value = ""; }
  return <section className="panel"><h2>Import / export</h2><p className="soft-copy">Back up or migrate shared settings, budget categories, subcategories, baseline revisions, monthly plans, and cash reports. Ledger transactions are synchronized separately and are never replaced by backup import.</p><div className="settings-actions"><button className="secondary-btn" type="button" onClick={onRefresh}>Refresh latest data</button><button className="secondary-btn" type="button" onClick={exportBackup}>Export backup</button><label className="secondary-btn file-label">Import backup<input type="file" accept="application/json,.json" onChange={importFile} /></label></div></section>;
}

function ImportPanel({ onComplete }) {
  const [file, setFile] = useState(null), [status, setStatus] = useState(""), [progress, setProgress] = useState(0), [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); if (!file) return; setBusy(true); try { const bundle = JSON.parse(await file.text()); setStatus("Uploading protected recovery snapshot…"); await importFinanceBundle(bundle, setProgress); setStatus("Recovery import complete."); await onComplete(); } catch (error) { setStatus(error.message); setBusy(false); } }
  return <form className="import-panel" onSubmit={submit}><label className="field"><span>Prepared local ledger bundle</span><input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>{busy && <progress max="100" value={progress}>{progress}%</progress>}<p className="save-state" role="status">{status}</p><button className="primary-btn" disabled={!file || busy} type="submit">{busy ? `Importing ${progress}%` : "Import recovery ledger"}</button></form>;
}
