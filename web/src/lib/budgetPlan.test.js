import test from "node:test";
import assert from "node:assert/strict";
import { buildBudgetPlan, legacyBudgetCatalog, resolveBudgetCatalog } from "./budgetPlan.js";

const state = { categories: [{ name: "Transport", budget: 500, spendingType: "flexible" }] };
const ledger = { recurringCosts: [
  { id: "insurance", category: "Transport", name: "Car insurance", monthlyFunding: 145 },
  { id: "tolls", category: "Transport", name: "Tolls", monthlyFunding: 180 },
] };
const month = "2026-09";
const categoryId = "legacy:category:Transport";

function modernCatalog() {
  return { schemaVersion: 2, categories: [{ id: "transport", name: "Transport", sourceNames: ["Transport"],
    order: 0, archived: false, commitment: "flexible", defaultAmount: 500 }], subcategories: [
    { id: "parking", categoryId: "transport", name: "Parking", order: 0, archived: false, kind: "group",
      targetEnabled: true, commitment: "flexible", schedule: "none", defaultAmount: 200 },
    { id: "insurance", categoryId: "transport", name: "Insurance", order: 1, archived: false, kind: "cost",
      targetEnabled: false, commitment: "committed", schedule: "monthly", defaultAmount: 145,
      recurringCostId: "insurance", parentSubcategoryId: "parking" },
  ] };
}
const shared = (catalog, bindings = []) => ({ budgetCatalogVersions: [{ effectiveFromMonth: month, catalog }], budgetMatchBindings: bindings });
const binding = (kind, subcategoryId, sourceKey) => ({ kind, categoryId: "transport", subcategoryId,
  sourceCategory: "Transport", sourceKey });

test("legacy categories upgrade to a direct total and known costs without General", () => {
  const plan = buildBudgetPlan(state, ledger, {}, month, [], [], 1000, 0.5);
  assert.equal(plan.total, 500);
  assert.equal(plan.categories[0].planned, 500);
  assert.equal(plan.categories[0].commitment, "flexible");
  assert.deepEqual(plan.subcategories.map((row) => row.name), ["Car insurance", "Tolls"]);
  assert.equal(plan.committedPlanned, 325);
  assert.equal(plan.flexiblePlanned, 175);
});

test("migration recognizes the synthetic General ID and keeps a user-created General group", () => {
  const catalog = legacyBudgetCatalog(state, ledger);
  catalog.subcategories[0].name = "Everyday travel";
  catalog.subcategories.push({ id: "custom-general", categoryId, name: "General", order: 3, archived: false,
    commitment: "flexible", schedule: "none", defaultAmount: 0, sourceLabels: [] });
  const plan = buildBudgetPlan(state, ledger, { budgetCatalogVersions: [{ effectiveFromMonth: month, catalog }] },
    month, [], [], 1000, 1);
  assert.equal(plan.subcategories.some((row) => row.id === catalog.subcategories[0].id), false);
  assert.equal(plan.subcategories.some((row) => row.id === "custom-general"), true);
  assert.equal(plan.total, 500);
});

test("all category transactions are available directly, including unreviewed and unmatched spending", () => {
  const rows = [
    { id: "a", category: "Transport", recurringCostId: "insurance", recurringReviewed: true, amount: 142 },
    { id: "b", category: "Transport", costLabel: "Parking", categoryReviewed: false, amount: 50 },
    { id: "c", category: "Transport", costLabel: "Parking", categoryReviewed: true, amount: 75 },
  ];
  const plan = buildBudgetPlan(state, ledger, {}, month, rows, rows, 1000, 0.5);
  assert.equal(plan.categories[0].actual, 267);
  assert.deepEqual(plan.transactionGroups.byCategory[categoryId], rows);
  assert.equal(plan.transactionGroups.unassigned[categoryId].length, 2);
  assert.equal(plan.subcategories.find((row) => row.recurringCostId === "insurance").actual, 142);
});

test("old monthly edits and recurring overrides preserve the category total", () => {
  const catalog = legacyBudgetCatalog(state, ledger);
  const general = catalog.subcategories[0];
  const saved = { [general.id]: 275 };
  const plan = buildBudgetPlan(state, ledger, { budgetCatalogVersions: [{ effectiveFromMonth: month, catalog }],
    budgetMonthPlans: { [month]: saved } }, month, [], [], 1000, 1);
  assert.equal(plan.total, 600);
  const overridden = buildBudgetPlan(state, ledger, { budgetCatalogVersions: [{ effectiveFromMonth: month, catalog }],
    budgetOverridesByMonth: { [month]: { Transport: 650 } },
    recurringOverridesByMonth: { [month]: { tolls: { amount: 200, included: true } } } }, month, [], [], 1000, 1);
  assert.equal(overridden.total, 650);
  assert.equal(overridden.subcategories.find((row) => row.recurringCostId === "tolls").planned, 200);
});

test("a category total is independent of optional group and cost reservations", () => {
  const catalog = modernCatalog();
  const plan = buildBudgetPlan(state, ledger, shared(catalog), month, [], [], 1000, 1);
  assert.equal(plan.total, 500);
  assert.equal(plan.committedPlanned, 145);
  assert.equal(plan.flexiblePlanned, 355);
  assert.equal(plan.categories[0].planned, 500);
  const later = { ...shared(catalog), budgetMonthPlans: { [month]: { transport: 600, parking: 250 } } };
  assert.equal(buildBudgetPlan(state, ledger, later, month, [], [], 1000, 1).total, 600);
});

test("exact reviewed labels and manual reviewed links organize transactions without changing the category", () => {
  const catalog = modernCatalog();
  const rows = [
    { id: "p1", category: "Transport", costLabel: " parking ", categoryReviewed: true, amount: 70 },
    { id: "p2", category: "Transport", costLabel: "Parking", categoryReviewed: false, amount: 30 },
    { id: "p3", category: "Transport", costLabel: "Other", categoryReviewed: true, amount: 20 },
    { id: "p4", category: "Other", costLabel: "Parking", categoryReviewed: true, amount: 10 },
  ];
  const plan = buildBudgetPlan(state, ledger, shared(catalog, [binding("label", "parking", "PARKING"),
    binding("transaction", "parking", "p3")]), month, rows, rows, 1000, 1);
  assert.equal(plan.categories.find((row) => row.name === "Transport").actual, 120);
  assert.equal(plan.subcategories.find((row) => row.id === "parking").actual, 90);
  assert.deepEqual(plan.transactionGroups.bySubcategory.parking, [rows[0], rows[2]]);
  assert.deepEqual(plan.transactionGroups.unassigned.transport, [rows[1]]);
});

test("a manual link to a reviewed ledger transaction follows its derived Budget event", () => {
  const row = { id: "purchase:transaction:source-1", sourceTransactionId: "source-1",
    category: "Transport", categoryReviewed: true, amount: 35 };
  const plan = buildBudgetPlan(state, ledger, shared(modernCatalog(), [binding("transaction", "parking", "source-1")]),
    month, [row], [row], 1000, 1);
  assert.equal(plan.subcategories.find((item) => item.id === "parking").actual, 35);
});

test("reviewed recurring ID wins over an exact label and a one-time manual link", () => {
  const catalog = modernCatalog();
  const row = { id: "bill", category: "Transport", costLabel: "Parking", categoryReviewed: true,
    recurringCostId: "insurance", recurringReviewed: true, amount: 140 };
  const plan = buildBudgetPlan(state, ledger, shared(catalog, [binding("recurring", "insurance", "insurance"),
    binding("label", "parking", "Parking"), binding("transaction", "parking", "bill")]),
  month, [row], [row], 1000, 1);
  assert.equal(plan.subcategories.find((item) => item.id === "insurance").actual, 140);
  assert.equal(plan.subcategories.find((item) => item.id === "parking").actual, 140);
  assert.equal(plan.categories[0].actual, 140);
});

test("renaming and archiving a group keep older matches and category totals", () => {
  const september = modernCatalog();
  const october = structuredClone(september);
  october.subcategories[0].name = "Parking and tolls";
  october.subcategories[0].archived = true;
  const versions = [{ effectiveFromMonth: month, catalog: september }, { effectiveFromMonth: "2026-10", catalog: october }];
  const bindings = [binding("label", "parking", "Parking")];
  const row = { id: "p", category: "Transport", costLabel: "Parking", categoryReviewed: true, amount: 25 };
  const earlier = buildBudgetPlan(state, ledger, { budgetCatalogVersions: versions, budgetMatchBindings: bindings },
    month, [row], [row], 1000, 1);
  const later = buildBudgetPlan(state, ledger, { budgetCatalogVersions: versions, budgetMatchBindings: bindings },
    "2026-10", [row], [row], 1000, 1);
  assert.equal(earlier.subcategories.find((item) => item.id === "parking").actual, 25);
  assert.equal(later.subcategories.find((item) => item.id === "parking").actual, 0);
  assert.equal(later.categories[0].actual, 25);
  assert.equal(resolveBudgetCatalog(state, ledger, { budgetCatalogVersions: versions }, month).allocations.transport, 500);
});

test("group-only subcategories do not add to the plan and periodic reserves are included once", () => {
  const catalog = modernCatalog();
  catalog.subcategories[0].targetEnabled = false;
  catalog.subcategories[0].defaultAmount = 0;
  catalog.subcategories[1].schedule = "periodic";
  const plan = buildBudgetPlan(state, ledger, shared(catalog), month, [], [], 1000, 1);
  assert.equal(plan.total, 500);
  assert.equal(plan.periodicPlanned, 145);
  assert.equal(plan.subcategories[0].planned, null);
});

test("one-time costs reserve only in the due month while the category baseline stays fixed", () => {
  const catalog = modernCatalog();
  catalog.subcategories[1].schedule = "one-time";
  catalog.subcategories[1].dueMonth = "2026-10";
  const revisions = { budgetCatalogVersions: [{ effectiveFromMonth: month, catalog }] };
  const september = buildBudgetPlan(state, ledger, revisions, month, [], [], 1000, 1);
  const october = buildBudgetPlan(state, ledger, revisions, "2026-10", [], [], 1000, 1);
  assert.equal(september.total, 500);
  assert.equal(september.subcategories.find((item) => item.id === "insurance").planned, 0);
  assert.equal(october.total, 500);
  assert.equal(october.subcategories.find((item) => item.id === "insurance").planned, 145);
  assert.equal(october.periodicPlanned, 145);
});

test("a targeted group can be over budget without duplicating its actual in the parent", () => {
  const row = { id: "parking-ticket", category: "Transport", categoryReviewed: true,
    costLabel: "Parking", amount: 230 };
  const plan = buildBudgetPlan(state, ledger, shared(modernCatalog(), [binding("label", "parking", "Parking")]),
    month, [row], [row], 1000, 1);
  assert.equal(plan.subcategories.find((item) => item.id === "parking").status, "Over");
  assert.equal(plan.categories[0].actual, 230);
  assert.equal(plan.categories[0].remaining, 270);
});

test("a duplicate exact label never assigns spending to either optional group", () => {
  const catalog = modernCatalog();
  catalog.subcategories.push({ ...catalog.subcategories[0], id: "second", name: "Second", order: 2,
    targetEnabled: false, defaultAmount: 0 });
  const row = { id: "duplicate", category: "Transport", categoryReviewed: true,
    costLabel: "Parking", amount: 30 };
  const plan = buildBudgetPlan(state, ledger, shared(catalog, [binding("label", "parking", "Parking"),
    binding("label", "second", "Parking")]), month, [row], [row], 1000, 1);
  assert.equal(plan.categories[0].actual, 30);
  assert.equal(plan.subcategories.find((item) => item.id === "parking").actual, 0);
  assert.deepEqual(plan.transactionGroups.unassigned.transport, [row]);
});
