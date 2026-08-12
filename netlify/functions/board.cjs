// This function is the ONLY thing that talks to Airtable directly.
// Your Airtable token lives in Netlify's environment variables (server-side),
// never in the browser bundle. The React app calls this function instead.

const AIRTABLE_API = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TOKEN = process.env.AIRTABLE_TOKEN;

// Table IDs for the three tables this app uses.
// Defaults match the dedicated "Daily Board" base Claude set up for you;
// override via env vars if you ever recreate the tables elsewhere.
const TABLES = {
  categories: process.env.AIRTABLE_CATEGORIES_TABLE_ID || "tbl2SyNAI3vA1MrIB",
  projects: process.env.AIRTABLE_PROJECTS_TABLE_ID || "tbleJF7zCxDWAl54m",
  tasks: process.env.AIRTABLE_TASKS_TABLE_ID || "tblArf0Rb1YwLOLES",
};

const STATUS_LABELS = { todo: "To do", waiting: "Waiting", done: "Done" };
const STATUS_KEYS = { "To do": "todo", "Waiting": "waiting", "Done": "done" };
const EFFORT_LABELS = { quick: "Quick & easy", high: "High impact" };
const EFFORT_KEYS = { "Quick & easy": "quick", "High impact": "high" };
const HEALTH_LABELS = { green: "On track", yellow: "Needs caution", black: "Needs attention" };
const HEALTH_KEYS = { "On track": "green", "Needs caution": "yellow", "Needs attention": "black" };

async function airtableFetch(path, options = {}) {
  const res = await fetch(`${AIRTABLE_API}/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}

async function listAll(tableId) {
  let records = [];
  let offset;
  do {
    const qs = offset ? `?pageSize=100&offset=${offset}` : "?pageSize=100";
    const data = await airtableFetch(`${tableId}${qs}`);
    records = records.concat(data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

// Converts the app's plain field names (name, status, categoryId, ...) into
// the Airtable field names + value formats this base expects.
function toAirtableFields(table, fields) {
  const out = {};
  if (table === "categories") {
    if ("name" in fields) out["Name"] = fields.name;
    if ("order" in fields) out["Order"] = fields.order;
    if ("priorityTaskId" in fields) out["Priority Task"] = fields.priorityTaskId ? [fields.priorityTaskId] : [];
  } else if (table === "projects") {
    if ("name" in fields) out["Name"] = fields.name;
    if ("categoryId" in fields) out["Category"] = fields.categoryId ? [fields.categoryId] : [];
    if ("health" in fields) out["Health"] = HEALTH_LABELS[fields.health] || null;
  } else if (table === "tasks") {
    if ("text" in fields) out["Text"] = fields.text;
    if ("status" in fields) out["Status"] = STATUS_LABELS[fields.status] || "To do";
    if ("effort" in fields) out["Effort"] = fields.effort ? EFFORT_LABELS[fields.effort] : null;
    if ("categoryId" in fields) out["Category"] = fields.categoryId ? [fields.categoryId] : [];
    if ("subcategoryId" in fields) out["Project"] = fields.subcategoryId ? [fields.subcategoryId] : [];
  }
  return out;
}

exports.handler = async (event) => {
  if (!BASE_ID || !TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing AIRTABLE_BASE_ID or AIRTABLE_TOKEN env vars" }) };
  }

  try {
    if (event.httpMethod === "GET") {
      const [catRecs, projRecs, taskRecs] = await Promise.all([
        listAll(TABLES.categories),
        listAll(TABLES.projects),
        listAll(TABLES.tasks),
      ]);

      const categories = catRecs
        .map((r) => ({
          id: r.id,
          name: r.fields["Name"] || "",
          order: typeof r.fields["Order"] === "number" ? r.fields["Order"] : 0,
          priorityTaskId: (r.fields["Priority Task"] || [])[0] || null,
        }))
        .sort((a, b) => a.order - b.order);

      const subcategories = projRecs.map((r) => ({
        id: r.id,
        name: r.fields["Name"] || "",
        categoryId: (r.fields["Category"] || [])[0] || null,
        health: HEALTH_KEYS[r.fields["Health"]] || "green",
      }));

      const tasks = taskRecs.map((r) => ({
        id: r.id,
        text: r.fields["Text"] || "",
        status: STATUS_KEYS[r.fields["Status"]] || "todo",
        effort: EFFORT_KEYS[r.fields["Effort"]] || null,
        categoryId: (r.fields["Category"] || [])[0] || null,
        subcategoryId: (r.fields["Project"] || [])[0] || null,
        createdAt: new Date(r.createdTime).getTime(),
      }));

      return {
        statusCode: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Content-Type": "application/json" },
        body: JSON.stringify({ categories, subcategories, tasks }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { table, op, id, fields } = body;
      const tableId = TABLES[table];
      if (!tableId) return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: `Unknown table: ${table}` }) };

      if (op === "create") {
        const data = await airtableFetch(tableId, {
          method: "POST",
          body: JSON.stringify({ records: [{ fields: toAirtableFields(table, fields) }], typecast: true }),
        });
        return { statusCode: 200, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ id: data.records[0].id }) };
      }

      if (op === "update") {
        await airtableFetch(tableId, {
          method: "PATCH",
          body: JSON.stringify({ records: [{ id, fields: toAirtableFields(table, fields) }], typecast: true }),
        });
        return { statusCode: 200, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ok: true }) };
      }

      if (op === "delete") {
        await airtableFetch(`${tableId}/${id}`, { method: "DELETE" });
        return { statusCode: 200, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: `Unknown op: ${op}` }) };
    }

    return { statusCode: 405, body: "Method not allowed" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
