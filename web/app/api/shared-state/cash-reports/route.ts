import { getDb } from "../../../../db";
import { requireApiUser } from "../../../server/access";
import { baseCurrency, cleanText, finiteMoney, parseRequestJson, readSharedState, validDate, type CashCurrency } from "../../../server/shared-state";

export async function POST(request: Request) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const type = body.type === "saved" ? "saved" : body.type === "spent" ? "spent" : null;
  const category = cleanText(body.category, 100);
  const currency = cleanText(body.currency, 3) as CashCurrency | null;
  const amount = finiteMoney(body.amount, 0.01);
  const date = body.date;
  const note = typeof body.note === "string" && body.note.trim().length <= 80 ? body.note.trim() : null;
  if (!type) return Response.json({ error: "Choose whether this cash was spent or saved." }, { status: 400 });
  if (!category) return Response.json({ error: "Choose a category." }, { status: 400 });
  if (!currency || currency !== await baseCurrency()) return Response.json({ error: "Choose a supported cash currency." }, { status: 400 });
  if (amount === null) return Response.json({ error: "Enter a cash amount greater than zero." }, { status: 400 });
  if (!validDate(date)) return Response.json({ error: "Choose a valid report date." }, { status: 400 });
  if (note === null) return Response.json({ error: "The note must be 80 characters or fewer." }, { status: 400 });
  const rate = { rateToNis: 1, rateLabel: `1 ${currency} = 1 ${currency}` };
  const id = `travel-cash-${crypto.randomUUID()}`;
  await getDb().prepare(`
    INSERT INTO cash_reports (
      id, type, category, currency, amount_minor, rate_to_nis, nis_value_cents,
      rate_label, report_date, note, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    id, type, category, currency, Math.round(amount * 100), rate.rateToNis,
    Math.round(amount * rate.rateToNis * 100), rate.rateLabel, date, note, access.user.userId
  ).run();
  return Response.json({ sharedState: await readSharedState() }, { status: 201 });
}
