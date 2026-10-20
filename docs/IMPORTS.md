# Import formats and accounting contract

The converter accepts one source file per preview/apply operation. Imported records accumulate in the ledger. Review overlapping exports carefully; imports do not silently remove old transactions that disappear from later statements.

## CSV mapping

A mapping is JSON with `schemaVersion: 1`, `columns`, `delimiter`, `dateFormat`, `decimalSeparator`, `thousandsSeparator`, and `signConvention`.

Supported date formats are `%Y-%m-%d`, `%d/%m/%Y`, `%m/%d/%Y`, and `%d.%m.%Y`. Choose one explicitly. Choose decimal `.` or `,`, and an optional thousands separator of `.`, `,`, or a space. UTF-8 and UTF-8 with BOM are supported.

Map these canonical fields to actual CSV header names:

| Field | Requirement |
| --- | --- |
| `date`, `description` | Required |
| `amount` | Required unless both `debit` and `credit` are mapped |
| `debit`, `credit` | Alternative to signed amount; nonnegative values, one nonzero side per row |
| `account` | Optional per-row configured account id; otherwise pass `--account` |
| `type`, `category`, `reference` | Optional, but strongly useful for review and stable identity |
| `currency` | Optional; if present must equal the household base currency |
| `billingDate` | Optional for card timing; required for explicitly marked installments |
| `isInstallment` | Optional `true`/`false` or `1`/`0`; never inferred from repeated amounts |
| `purchaseAmount` | Optional purchase principal, in the base currency |
| `installmentNumber`, `installmentCount` | Optional together; explicit integers from 1 through 120 |

For signed amounts, `debit_negative` means negative is money out and positive is money in. `debit_positive` reverses that convention. Split debit/credit columns always use credit minus debit.

Types are `expense`, `income`, `refund`, `transfer`, `card_settlement`, `cash_withdrawal`, and `fee`. An optional mapping `types` object translates source labels, for example `{"Payment": "expense", "Transfer": "transfer"}`. Without an explicit type or matching household rule, outflows become expenses and inflows become income, except card inflows become refunds. Verify those defaults before applying.

Card settlement payments and transfers remain visible as account movements and do not increase spending. A credit-card purchase and its bank settlement must not both be classified as an expense. Refunds reduce merchant spending and are not salary income.

Amounts must be finite, nonzero, and have at most two decimal places. A malformed row makes the whole preview fail; no partial apply is allowed. The preview records row locations and review details in the ignored outputs folder.

## Identity and repeated exports

Transaction identities use account, date, description, amount, direction, type, billing information, and source reference. A repeated unchanged referenced record is deduplicated. Distinct identical purchases without references are preserved by occurrence within the source file; a repeated full export preserves those occurrences.

Without stable references, partially overlapping exports can be ambiguous. Review the preview counts and do not assume the tool can prove that two identical purchases are the same event. Corrections to already imported amounts/descriptions/types require an explicit ledger correction and reconciliation; the importer does not silently overwrite old evidence.

## Existing Israeli XLSX layouts

These adapters require an ILS household and a configured `--account`:

```bash
.venv/bin/python scripts/convert_bank_exports.py \
  --format israeli-bank --input "Finance Imports/bank.xlsx" \
  --account checking --bank-order newest-first

.venv/bin/python scripts/convert_bank_exports.py \
  --format israeli-card --input "Finance Imports/card.xlsx" --account card
```

The bank adapter reads the existing operations workbook layout with transaction rows starting at row 6 and running balance columns. Select `oldest-first` if that is the actual row order. Adjacent running balances must reconcile.

The card adapter supports the existing Hebrew card section/header layout and Diners detail layout. It uses settled ILS charges, not invented FX rates. Unsupported files, pending card transactions, and revolving-credit adjustments stop the import and require a settled export or an explicit CSV mapping. Installments require explicit provider metadata; a missing count remains provisional in the dashboard.

Each adapter is tested with fabricated workbooks. Bank/provider layout changes are not automatically recognized. An explicit CSV mapping is the fallback for other institutions.

## Add a parser

1. Add a format adapter in `scripts/import_formats.py`. Return raw canonical rows plus row-level audit results; do not write the ledger from a parser.
2. Preserve source file/row evidence. Keep account identity and household rules in configuration.
3. Convert only a supplied or settled base-currency amount. Never silently infer FX or a financing plan.
4. Fail on unsupported or inconsistent accounting rather than silently discarding financial movements.
5. Add synthetic success, malformed-input, overlap, duplicate, refund, and reconciliation tests. Update the supported-format documentation.

The common pipeline owns normalization, deterministic identity, preview freshness, apply, and validation. Keep new adapters inside that boundary.
