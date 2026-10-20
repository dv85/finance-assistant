import { getDb } from "../../../../../db";
import { requireOwnerOrSync } from "../../../../server/access";

const MAX_STATE_BYTES = 1_500_000;

export async function POST(request: Request) {
  const access = await requireOwnerOrSync(request);
  if (access instanceof Response) return access;
  const body = await request.json() as Record<string, unknown>;
  if (body.schemaVersion !== "finance-sites-import/v1") {
    return Response.json({ error: "Unsupported import bundle version" }, { status: 400 });
  }
  if (!body.state || typeof body.state !== "object" || !body.expected || typeof body.expected !== "object") {
    return Response.json({ error: "Import state and expected counts are required" }, { status: 400 });
  }
  const stateJson = JSON.stringify(body.state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_STATE_BYTES) {
    return Response.json({ error: "Import state is too large" }, { status: 413 });
  }
  const snapshotId = crypto.randomUUID();
  const db = getDb();
  await db.batch([
    db.prepare(`INSERT INTO data_snapshots (id, status, source_hash, schema_version, expected_json, created_by)
      VALUES (?, 'staging', ?, ?, ?, ?)`).bind(
        snapshotId,
        String(body.sourceHash ?? ""),
        String(body.schemaVersion),
        JSON.stringify(body.expected),
        access.user.userId,
      ),
    db.prepare("INSERT INTO snapshot_state (snapshot_id, state_json) VALUES (?, ?)").bind(snapshotId, stateJson),
  ]);
  return Response.json({ snapshotId }, { status: 201 });
}
