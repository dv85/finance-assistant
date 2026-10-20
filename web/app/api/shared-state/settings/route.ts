import { getDb } from "../../../../db";
import { requireApiUser } from "../../../server/access";
import { baseCurrency, cleanText, finiteMoney, parseRequestJson, readSharedState } from "../../../server/shared-state";

const CURRENCIES = new Set(["ILS", "USD", "EUR", "GBP"]);

export async function PUT(request: Request) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const currency = cleanText(body.currency, 3);
  const openingBalance = finiteMoney(body.openingBalance, -1_000_000_000);
  const bufferTarget = body.bufferTarget === undefined ? null : finiteMoney(body.bufferTarget);
  if (!currency || currency !== await baseCurrency()) return Response.json({ error: "Choose a supported currency." }, { status: 400 });
  if (openingBalance === null) return Response.json({ error: "Opening balance must be a valid amount." }, { status: 400 });
  if (body.bufferTarget !== undefined && bufferTarget === null) return Response.json({ error: "Comfort buffer must be a valid non-negative amount." }, { status: 400 });
  await getDb().prepare(`
    INSERT INTO household_settings (id, currency, opening_balance_cents, buffer_target_cents, updated_by, updated_at)
    VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      currency = excluded.currency,
      opening_balance_cents = excluded.opening_balance_cents,
      buffer_target_cents = COALESCE(excluded.buffer_target_cents, household_settings.buffer_target_cents),
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).bind(currency, Math.round(openingBalance * 100), bufferTarget === null ? null : Math.round(bufferTarget * 100), access.user.userId).run();
  return Response.json({ sharedState: await readSharedState() });
}
