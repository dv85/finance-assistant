import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { purchaseEvents } from "../src/lib/finance.js";

test("Python snapshot and JavaScript calculations roundtrip synthetic installments", () => {
  const ledger = JSON.parse(readFileSync(new URL("../../harness/data/sample-ledger.json", import.meta.url), "utf8"));
  const python = process.env.FINANCE_PYTHON || (process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python");
  const result = spawnSync(python, ["-c", 'import sys,json; sys.path.insert(0,"../scripts"); from build_sites_import import build_transactions; ledger=json.load(sys.stdin); rows=build_transactions(ledger); print(json.dumps({"rows": rows, "plans": ledger["installmentPlans"]}))'], { input: JSON.stringify(ledger), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || "Create the root Python virtualenv first; see README.");
  const { rows, plans } = JSON.parse(result.stdout);
  const wire = { installmentPlans: plans, transactions: rows.map(row => ({ ...row.metadata, id: row.sourceId, date: row.transactionDate, billingDate: row.billingDate, amount: row.amountCents / 100, isInstallment: row.isInstallment, type: row.type, direction: row.direction, category: row.category })) };
  assert.equal(rows.length, ledger.transactions.length);
  assert.equal(purchaseEvents(wire).filter(row => row.isInstallment).reduce((sum, row) => sum + row.amount, 0), 60);
  for (const plan of plans.filter(row => row.status === "ready")) assert.equal(plan.schedule.reduce((sum, row) => sum + Math.round(row.amount * 100), 0), Math.round(plan.purchaseAmount * 100));
});

test("distinct purchase references survive Python import and snapshot without losing spending", () => {
  const python = process.env.FINANCE_PYTHON || (process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python");
  const program = `import sys,json
sys.path.insert(0,"../scripts")
from pathlib import Path
from household_config import load_config
from ledger_memory import empty_ledger
from convert_bank_exports import prepare_import
from build_sites_import import build_transactions
config=load_config(Path("../examples/household.example.json"))
rows=[dict(account="card",date="2025-04-02",description="Example Store",signedAmount=-50,reference=ref,source="synthetic.csv",sourceRow=i+2,isInstallment=True,purchaseAmount=100,installmentNumber=n,installmentCount=2,billingDate=f"2025-{n+4:02d}-10") for i,(ref,n) in enumerate((ref,n) for ref in ["alpha","beta"] for n in [1,2])]
ledger,report=prepare_import(empty_ledger(config),config,rows,{"errors":[]},None,"synthetic")
assert report["status"]=="pass"
wire=build_transactions(ledger)
print(json.dumps(dict(rows=wire,plans=ledger["installmentPlans"])))`;
  const result = spawnSync(python, ["-c", program], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const { rows, plans } = JSON.parse(result.stdout);
  const ledger = { installmentPlans: plans, transactions: rows.map(row => ({ ...row.metadata, id: row.sourceId,
    date: row.transactionDate, billingDate: row.billingDate, amount: row.amountCents / 100, isInstallment: row.isInstallment, type: row.type })) };
  assert.equal(plans.length, 2);
  assert.equal(purchaseEvents(ledger).length, 2);
  assert.equal(purchaseEvents(ledger).reduce((total, row) => total + row.amount, 0), 200);
});
