async function requestJson(path, options) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${path} returned ${response.status}`);
  return payload;
}

export async function loadFinanceData() {
  return requestJson("/api/finance");
}

export async function loadHouseholdMembers() {
  return requestJson("/api/household-members");
}

export async function addHouseholdMember(email) {
  return requestJson("/api/household-members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
}

export async function removeHouseholdMember(email) {
  return requestJson(`/api/household-members/${encodeURIComponent(email)}`, { method: "DELETE" });
}

export async function saveSharedSettings(settings) {
  return requestJson("/api/shared-state/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
}

export async function saveBudgetOverrides(month, overrides) {
  return requestJson(`/api/shared-state/budgets/${encodeURIComponent(month)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overrides })
  });
}

export async function saveBudgetPlan(change) {
  return requestJson("/api/shared-state/budget-plan", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change)
  });
}

export async function resetBudgetOverrides(month) {
  return requestJson(`/api/shared-state/budgets/${encodeURIComponent(month)}`, { method: "DELETE" });
}

export async function saveRecurringOverrides(month, overrides) {
  return requestJson(`/api/shared-state/recurring-costs/${encodeURIComponent(month)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overrides })
  });
}

export async function resetRecurringOverrides(month) {
  return requestJson(`/api/shared-state/recurring-costs/${encodeURIComponent(month)}`, { method: "DELETE" });
}

export async function saveCategorySettings(settings) {
  return requestJson("/api/shared-state/category-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings })
  });
}

export async function addCashReport(entry) {
  return requestJson("/api/shared-state/cash-reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry)
  });
}

export async function deleteCashReport(id) {
  return requestJson(`/api/shared-state/cash-reports/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function importSharedBackup(backup) {
  return requestJson("/api/shared-state/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(backup)
  });
}

export async function downloadSharedBackup() {
  return requestJson("/api/shared-state/backup");
}

export async function importFinanceBundle(bundle, onProgress = () => {}) {
  if (bundle?.schemaVersion !== "finance-sites-import/v1") {
    throw new Error("Choose a finance-sites-import/v1 bundle.");
  }
  const start = await requestJson("/api/admin/imports/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: bundle.schemaVersion,
      sourceHash: bundle.sourceHash,
      createdAt: bundle.createdAt,
      state: bundle.state,
      expected: bundle.expected
    })
  });
  const snapshotId = start.snapshotId;
  const entities = ["accounts", "transactions", "balanceSnapshots", "importRuns"];
  const total = entities.reduce((sum, entity) => sum + (bundle[entity]?.length || 0), 0);
  let completed = 0;
  try {
    for (const entity of entities) {
      const rows = bundle[entity] || [];
      for (let offset = 0; offset < rows.length; offset += 100) {
        const chunk = rows.slice(offset, offset + 100);
        await requestJson(`/api/admin/imports/${snapshotId}/chunk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity, rows: chunk })
        });
        completed += chunk.length;
        onProgress(total ? Math.round((completed / total) * 100) : 100);
      }
    }
    await requestJson(`/api/admin/imports/${snapshotId}/commit`, { method: "POST" });
    onProgress(100);
  } catch (error) {
    await fetch(`/api/admin/imports/${snapshotId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}
