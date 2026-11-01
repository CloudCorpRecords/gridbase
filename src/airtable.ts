/**
 * gridbase core: fifteen tools against the Airtable Web API.
 *
 * All calls go to https://api.airtable.com/v0 with the personal access
 * token from AIRTABLE_API_KEY sent as an `Authorization: Bearer`
 * header:
 *
 *   list_bases     GET    /meta/bases
 *   list_tables    GET    /meta/bases/{base}/tables
 *   describe_table GET    /meta/bases/{base}/tables, filtered locally
 *   list_records   GET    /{base}/{table}?maxRecords&filterByFormula
 *   search_records GET    /{base}/{table}, then a local text match
 *   get_record     GET    /{base}/{table}/{record}
 *   create_record  POST   /{base}/{table}            body {fields}
 *   update_records PATCH  /{base}/{table}            body {records}
 *   delete_records DELETE /{base}/{table}?records[]=...
 *   create_table   POST   /meta/bases/{base}/tables
 *   update_table   PATCH  /meta/bases/{base}/tables/{table}
 *   create_field   POST   /meta/bases/{base}/tables/{table}/fields
 *   update_field   PATCH  /meta/bases/{base}/tables/{table}/fields/{field}
 *   create_comment POST   /{base}/{table}/{record}/comments
 *   list_comments  GET    /{base}/{table}/{record}/comments
 *
 * Airtable has no text-search endpoint, so search_records lists the
 * table (bounded by maxRecords) and keeps records whose field values
 * contain the term, restricted to fieldIds when given — the same
 * contract the documented tool describes.
 *
 * Schema reads honour detailLevel by trimming the meta payload:
 * tableIdentifiersOnly keeps table id/name only, identifiersOnly keeps
 * field/view ids and names, full returns the payload untouched.
 *
 * A missing token is an error before any request is made, and the
 * error names the AIRTABLE_API_KEY variable. HTTP failures surface the
 * status plus Airtable's own error payload when present. All HTTP goes
 * through an injected FetchFn so everything is testable offline.
 */
import type {
  CreateCommentOptions,
  CreateFieldOptions,
  CreateRecordOptions,
  CreateTableOptions,
  DeleteRecordsOptions,
  DescribeTableOptions,
  FetchFn,
  GetRecordOptions,
  ListCommentsOptions,
  ListRecordsOptions,
  ListTablesOptions,
  SearchRecordsOptions,
  UpdateFieldOptions,
  UpdateRecordsOptions,
  UpdateTableOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const API_BASE = "https://api.airtable.com/v0";

export const API_KEY_ENV = "AIRTABLE_API_KEY";

export const DEFAULT_MAX_RECORDS = 100;

const DETAIL_LEVELS = ["tableIdentifiersOnly", "identifiersOnly", "full"];

/** The honest missing-key error. Names the variable, never a value. */
export function requireApiKey(apiKey: string | undefined): string {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    throw new Error(
      "AIRTABLE_API_KEY environment variable is required: set AIRTABLE_API_KEY to an Airtable personal access token and retry",
    );
  }
  return key;
}

function requireId(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

function requireDetailLevel(level: string | undefined): string {
  if (level === undefined) return "full";
  if (!DETAIL_LEVELS.includes(level)) {
    throw new Error(`detailLevel must be one of ${DETAIL_LEVELS.join(", ")}`);
  }
  return level;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

interface CallInit {
  method?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
}

async function callAirtable(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  path: string,
  init: CallInit = {},
): Promise<unknown> {
  const key = requireApiKey(apiKey);
  let url = `${API_BASE}${path}`;
  if (init.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (Array.isArray(v)) for (const item of v) params.append(k, item);
      else params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  let response;
  try {
    response = await fetchFn(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Airtable API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error)) {
        const type = typeof payload.error.type === "string" ? payload.error.type : "";
        const message = typeof payload.error.message === "string" ? payload.error.message : "";
        detail = `: ${[type, message].filter(Boolean).join(" - ")}`.trimEnd();
        if (detail === ":") detail = "";
      }
    } catch {
      // A non-JSON error body still reports its HTTP status below.
    }
    throw new Error(
      `Airtable API request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail}`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Airtable API returned a response that was not valid JSON");
  }
}

/** Keep only the id/name of each table (tableIdentifiersOnly). */
export function trimTableIdentifiers(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.tables)) return payload;
  return {
    tables: payload.tables.map((t) =>
      isRecord(t) ? { id: t.id, name: t.name } : t,
    ),
  };
}

/** Keep ids and names for tables, fields, and views (identifiersOnly). */
export function trimIdentifiers(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.tables)) return payload;
  const trimNamed = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.map((item) => (isRecord(item) ? { id: item.id, name: item.name } : item))
      : list;
  return {
    tables: payload.tables.map((t) =>
      isRecord(t) ? { ...t, fields: trimNamed(t.fields), views: trimNamed(t.views) } : t,
    ),
  };
}

function applyDetailLevel(payload: unknown, level: string): unknown {
  if (level === "tableIdentifiersOnly") return trimTableIdentifiers(payload);
  if (level === "identifiersOnly") return trimIdentifiers(payload);
  return payload;
}

/** List every accessible base. */
export async function listBases(
  fetchFn: FetchFn,
  apiKey: string | undefined,
): Promise<unknown> {
  return callAirtable(fetchFn, apiKey, "/meta/bases");
}

/** List the tables in a base at the requested detail level. */
export async function listTables(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListTablesOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const level = requireDetailLevel(options.detailLevel);
  const payload = await callAirtable(fetchFn, apiKey, `/meta/bases/${seg(baseId)}/tables`);
  return applyDetailLevel(payload, level);
}

/** Describe one table in a base. */
export async function describeTable(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DescribeTableOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const level = requireDetailLevel(options.detailLevel);
  const payload = await callAirtable(fetchFn, apiKey, `/meta/bases/${seg(baseId)}/tables`);
  if (!isRecord(payload) || !Array.isArray(payload.tables)) return payload;
  const table = payload.tables.find((t) => isRecord(t) && (t.id === tableId || t.name === tableId));
  if (!table) throw new Error(`table not found in base ${baseId}: ${tableId}`);
  return applyDetailLevel({ tables: [table] }, level);
}

/** List records from a table, with an optional formula filter. */
export async function listRecords(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListRecordsOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const query: Record<string, string> = {
    maxRecords: String(
      options.maxRecords !== undefined && Number.isFinite(options.maxRecords) && options.maxRecords > 0
        ? Math.floor(options.maxRecords)
        : DEFAULT_MAX_RECORDS,
    ),
  };
  if (options.filterByFormula) query.filterByFormula = options.filterByFormula;
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}`, { query });
}

/** Does one record contain the term, in the chosen fields or all of them? */
export function recordMatches(
  record: unknown,
  searchTerm: string,
  fieldIds?: string[],
): boolean {
  if (!isRecord(record) || !isRecord(record.fields)) return false;
  const term = searchTerm.toLowerCase();
  const wanted = fieldIds && fieldIds.length > 0 ? new Set(fieldIds) : null;
  for (const [fieldKey, value] of Object.entries(record.fields)) {
    if (wanted && !wanted.has(fieldKey)) continue;
    const texts: string[] =
      typeof value === "string"
        ? [value]
        : typeof value === "number"
          ? [String(value)]
          : Array.isArray(value)
            ? value.filter((v): v is string => typeof v === "string")
            : [];
    if (texts.some((t) => t.toLowerCase().includes(term))) return true;
  }
  return false;
}

/** Search records in a table for a text term. */
export async function searchRecords(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: SearchRecordsOptions,
): Promise<unknown> {
  const term = typeof options.searchTerm === "string" ? options.searchTerm.trim() : "";
  if (!term) throw new Error("searchTerm must be a non-empty string");
  const payload = await listRecords(fetchFn, apiKey, {
    baseId: options.baseId,
    tableId: options.tableId,
    maxRecords: options.maxRecords,
  });
  if (!isRecord(payload) || !Array.isArray(payload.records)) return payload;
  return {
    records: payload.records.filter((r) => recordMatches(r, term, options.fieldIds)),
  };
}

/** Fetch one record by ID. */
export async function getRecord(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: GetRecordOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const recordId = requireId(options.recordId, "recordId");
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}/${seg(recordId)}`);
}

/** Create a record from a fields object. */
export async function createRecord(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateRecordOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  if (!isRecord(options.fields)) throw new Error("fields must be an object of field values");
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}`, {
    method: "POST",
    body: { fields: options.fields },
  });
}

/** Update one or more records. */
export async function updateRecords(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: UpdateRecordsOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  if (!Array.isArray(options.records) || options.records.length === 0) {
    throw new Error("records must be a non-empty array of {id, fields} objects");
  }
  for (const rec of options.records) {
    if (!isRecord(rec) || typeof rec.id !== "string" || !isRecord(rec.fields)) {
      throw new Error("each entry in records must be an object with id and fields");
    }
  }
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}`, {
    method: "PATCH",
    body: { records: options.records },
  });
}

/** Delete one or more records by ID. */
export async function deleteRecords(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: DeleteRecordsOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  if (!Array.isArray(options.recordIds) || options.recordIds.length === 0) {
    throw new Error("recordIds must be a non-empty array of record IDs");
  }
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}`, {
    method: "DELETE",
    query: { "records[]": options.recordIds },
  });
}

/** Create a table in a base. */
export async function createTable(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateTableOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const name = requireId(options.name, "name");
  if (!Array.isArray(options.fields) || options.fields.length === 0) {
    throw new Error("fields must be a non-empty array of field definitions");
  }
  const body: Record<string, unknown> = { name, fields: options.fields };
  if (options.description !== undefined) body.description = options.description;
  return callAirtable(fetchFn, apiKey, `/meta/bases/${seg(baseId)}/tables`, {
    method: "POST",
    body,
  });
}

/** Update a table's name or description. */
export async function updateTable(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: UpdateTableOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  if (options.name === undefined && options.description === undefined) {
    throw new Error("update_table needs a name or a description to change");
  }
  const body: Record<string, unknown> = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.description !== undefined) body.description = options.description;
  return callAirtable(fetchFn, apiKey, `/meta/bases/${seg(baseId)}/tables/${seg(tableId)}`, {
    method: "PATCH",
    body,
  });
}

/** Create a field in a table. */
export async function createField(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateFieldOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const body: Record<string, unknown> = {
    name: requireId(options.name, "name"),
    type: requireId(options.type, "type"),
  };
  if (options.description !== undefined) body.description = options.description;
  if (options.options !== undefined) body.options = options.options;
  return callAirtable(fetchFn, apiKey, `/meta/bases/${seg(baseId)}/tables/${seg(tableId)}/fields`, {
    method: "POST",
    body,
  });
}

/** Update a field's name or description. */
export async function updateField(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: UpdateFieldOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const fieldId = requireId(options.fieldId, "fieldId");
  if (options.name === undefined && options.description === undefined) {
    throw new Error("update_field needs a name or a description to change");
  }
  const body: Record<string, unknown> = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.description !== undefined) body.description = options.description;
  return callAirtable(
    fetchFn,
    apiKey,
    `/meta/bases/${seg(baseId)}/tables/${seg(tableId)}/fields/${seg(fieldId)}`,
    { method: "PATCH", body },
  );
}

/** Add a comment to a record. */
export async function createComment(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: CreateCommentOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const recordId = requireId(options.recordId, "recordId");
  const text = typeof options.text === "string" ? options.text.trim() : "";
  if (!text) throw new Error("text must be a non-empty string");
  const body: Record<string, unknown> = { text };
  if (options.parentCommentId !== undefined) body.parentCommentId = options.parentCommentId;
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}/${seg(recordId)}/comments`, {
    method: "POST",
    body,
  });
}

/** List the comments on a record. */
export async function listComments(
  fetchFn: FetchFn,
  apiKey: string | undefined,
  options: ListCommentsOptions,
): Promise<unknown> {
  const baseId = requireId(options.baseId, "baseId");
  const tableId = requireId(options.tableId, "tableId");
  const recordId = requireId(options.recordId, "recordId");
  const query: Record<string, string> = {};
  if (options.pageSize !== undefined && Number.isFinite(options.pageSize)) {
    query.pageSize = String(Math.min(100, Math.max(1, Math.floor(options.pageSize))));
  }
  if (options.offset !== undefined) query.offset = options.offset;
  return callAirtable(fetchFn, apiKey, `/${seg(baseId)}/${seg(tableId)}/${seg(recordId)}/comments`, {
    query,
  });
}

/** Render an upstream payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
