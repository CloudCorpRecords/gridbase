import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createComment,
  createRecord,
  deleteRecords,
  describeTable,
  getRecord,
  listBases,
  listComments,
  listRecords,
  listTables,
  recordMatches,
  requireApiKey,
  searchRecords,
  updateRecords,
} from "../src/airtable.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

// Hand-written fixtures in the documented shapes of the Airtable Web
// API: meta endpoints answer with bases/tables arrays, record endpoints
// with records arrays or single record objects.
const BASES_PAYLOAD = {
  bases: [{ id: "appBase1", name: "Projects", permissionLevel: "create" }],
};

const TABLES_PAYLOAD = {
  tables: [
    {
      id: "tblTasks",
      name: "Tasks",
      description: "Work items",
      fields: [
        { id: "fldName", name: "Name", type: "singleLineText" },
        { id: "fldStatus", name: "Status", type: "singleSelect" },
      ],
      views: [{ id: "viwAll", name: "All tasks", type: "grid" }],
    },
    {
      id: "tblNotes",
      name: "Notes",
      fields: [{ id: "fldBody", name: "Body", type: "multilineText" }],
      views: [],
    },
  ],
};

const RECORDS_PAYLOAD = {
  records: [
    { id: "rec1", createdTime: "2026-01-01T00:00:00.000Z", fields: { fldName: "Write the report", fldStatus: "Open" } },
    { id: "rec2", createdTime: "2026-01-02T00:00:00.000Z", fields: { fldName: "Book flights", fldStatus: "Done" } },
  ],
};

const COMMENTS_PAYLOAD = {
  comments: [{ id: "com1", text: "Looks good", author: { id: "usr1" } }],
  offset: undefined,
};

function jsonResponse(body: unknown, status = 200, statusText = "OK"): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Captured {
  url?: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function fakeFetch(captured: Captured, body?: unknown): FetchFn {
  return async (url: string, init?: Captured["init"]) => {
    captured.url = url;
    captured.init = init;
    if (body !== undefined) return jsonResponse(body);
    if (url.includes("/meta/bases") && url.endsWith("/tables")) return jsonResponse(TABLES_PAYLOAD);
    if (url.includes("/meta/bases")) return jsonResponse(BASES_PAYLOAD);
    if (url.includes("/comments")) return jsonResponse(COMMENTS_PAYLOAD);
    if (url.includes("/rec1")) return jsonResponse(RECORDS_PAYLOAD.records[0]);
    return jsonResponse(RECORDS_PAYLOAD);
  };
}

describe("requireApiKey", () => {
  it("rejects a missing or blank token with an error naming AIRTABLE_API_KEY", () => {
    assert.throws(() => requireApiKey(undefined), /AIRTABLE_API_KEY/);
    assert.throws(() => requireApiKey("  "), /AIRTABLE_API_KEY/);
    assert.equal(requireApiKey(" pat123 "), "pat123");
  });
});

describe("listBases", () => {
  it("calls the meta bases endpoint with the Bearer header", async () => {
    const captured: Captured = {};
    const out = (await listBases(fakeFetch(captured), "pat123")) as typeof BASES_PAYLOAD;
    assert.equal(out.bases[0].name, "Projects");
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/v0/meta/bases");
    assert.equal(captured.init?.headers?.Authorization, "Bearer pat123");
    assert.equal(captured.init?.method, "GET");
  });

  it("fails before any request when the key is missing", async () => {
    let called = false;
    const spy: FetchFn = async () => {
      called = true;
      return jsonResponse({});
    };
    await assert.rejects(() => listBases(spy, undefined), /AIRTABLE_API_KEY/);
    assert.equal(called, false);
  });
});

describe("listTables / describeTable", () => {
  it("returns the full schema by default", async () => {
    const captured: Captured = {};
    const out = (await listTables(fakeFetch(captured), "k", { baseId: "appBase1" })) as typeof TABLES_PAYLOAD;
    assert.equal(out.tables.length, 2);
    assert.equal(out.tables[0].fields.length, 2);
    assert.equal(new URL(captured.url ?? "").pathname, "/v0/meta/bases/appBase1/tables");
  });

  it("trims to identifiers when detailLevel asks for it", async () => {
    const trimmed = (await listTables(fakeFetch({}), "k", {
      baseId: "appBase1",
      detailLevel: "tableIdentifiersOnly",
    })) as { tables: Record<string, unknown>[] };
    assert.deepEqual(trimmed.tables[0], { id: "tblTasks", name: "Tasks" });
    const idsOnly = (await listTables(fakeFetch({}), "k", {
      baseId: "appBase1",
      detailLevel: "identifiersOnly",
    })) as typeof TABLES_PAYLOAD;
    assert.deepEqual(idsOnly.tables[0].fields[0], { id: "fldName", name: "Name" });
  });

  it("describe_table returns only the requested table and errors when absent", async () => {
    const out = (await describeTable(fakeFetch({}), "k", {
      baseId: "appBase1",
      tableId: "tblNotes",
    })) as typeof TABLES_PAYLOAD;
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].name, "Notes");
    await assert.rejects(
      () => describeTable(fakeFetch({}), "k", { baseId: "appBase1", tableId: "tblMissing" }),
      /table not found/,
    );
  });

  it("rejects an unknown detailLevel", async () => {
    await assert.rejects(
      () => listTables(fakeFetch({}), "k", { baseId: "appBase1", detailLevel: "everything" }),
      /detailLevel must be one of/,
    );
  });
});

describe("listRecords / getRecord", () => {
  it("shapes the record URL with maxRecords and filterByFormula", async () => {
    const captured: Captured = {};
    const out = (await listRecords(fakeFetch(captured), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      maxRecords: 5,
      filterByFormula: "{Status}='Open'",
    })) as typeof RECORDS_PAYLOAD;
    assert.equal(out.records.length, 2);
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/v0/appBase1/tblTasks");
    assert.equal(url.searchParams.get("maxRecords"), "5");
    assert.equal(url.searchParams.get("filterByFormula"), "{Status}='Open'");
  });

  it("defaults maxRecords to 100 and URL-encodes table names", async () => {
    const captured: Captured = {};
    await listRecords(fakeFetch(captured), "k", { baseId: "appBase1", tableId: "My Table" });
    const url = new URL(captured.url ?? "");
    assert.equal(url.pathname, "/v0/appBase1/My%20Table");
    assert.equal(url.searchParams.get("maxRecords"), "100");
  });

  it("gets one record by ID", async () => {
    const captured: Captured = {};
    const out = (await getRecord(fakeFetch(captured), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      recordId: "rec1",
    })) as { id: string };
    assert.equal(out.id, "rec1");
    assert.equal(new URL(captured.url ?? "").pathname, "/v0/appBase1/tblTasks/rec1");
  });
});

describe("searchRecords", () => {
  it("matches the term case-insensitively across fields", async () => {
    const out = (await searchRecords(fakeFetch({}), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      searchTerm: "REPORT",
    })) as typeof RECORDS_PAYLOAD;
    assert.deepEqual(out.records.map((r) => r.id), ["rec1"]);
  });

  it("restricts matching to fieldIds when given", () => {
    const rec = RECORDS_PAYLOAD.records[0];
    assert.equal(recordMatches(rec, "open", ["fldStatus"]), true);
    assert.equal(recordMatches(rec, "open", ["fldName"]), false);
    assert.equal(recordMatches(rec, "report", ["fldName"]), true);
  });
});

describe("write tools", () => {
  it("create_record POSTs a {fields} body as JSON", async () => {
    const captured: Captured = {};
    await createRecord(fakeFetch(captured, { id: "recNew", fields: {} }), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      fields: { Name: "New task" },
    });
    assert.equal(captured.init?.method, "POST");
    assert.equal(captured.init?.headers?.["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(captured.init?.body ?? "{}"), { fields: { Name: "New task" } });
  });

  it("update_records PATCHes a {records} body", async () => {
    const captured: Captured = {};
    await updateRecords(fakeFetch(captured, { records: [] }), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      records: [{ id: "rec1", fields: { Status: "Done" } }],
    });
    assert.equal(captured.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(captured.init?.body ?? "{}"), {
      records: [{ id: "rec1", fields: { Status: "Done" } }],
    });
  });

  it("delete_records issues a DELETE with repeated records[] params", async () => {
    const captured: Captured = {};
    await deleteRecords(fakeFetch(captured, { records: [] }), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      recordIds: ["rec1", "rec2"],
    });
    assert.equal(captured.init?.method, "DELETE");
    const url = new URL(captured.url ?? "");
    assert.deepEqual(url.searchParams.getAll("records[]"), ["rec1", "rec2"]);
  });

  it("create_comment POSTs to the record comments path; list_comments reads it with paging", async () => {
    const captured: Captured = {};
    await createComment(fakeFetch(captured, { id: "com9" }), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      recordId: "rec1",
      text: "hello",
    });
    assert.equal(new URL(captured.url ?? "").pathname, "/v0/appBase1/tblTasks/rec1/comments");
    assert.deepEqual(JSON.parse(captured.init?.body ?? "{}"), { text: "hello" });
    const listed: Captured = {};
    await listComments(fakeFetch(listed), "k", {
      baseId: "appBase1",
      tableId: "tblTasks",
      recordId: "rec1",
      pageSize: 10,
    });
    assert.equal(new URL(listed.url ?? "").searchParams.get("pageSize"), "10");
  });
});

describe("upstream error handling", () => {
  it("surfaces the HTTP status and Airtable's error type and message", async () => {
    const failing: FetchFn = async () =>
      jsonResponse(
        { error: { type: "NOT_FOUND", message: "base missing" } },
        404,
        "Not Found",
      );
    await assert.rejects(() => listBases(failing, "k"), /HTTP 404.*NOT_FOUND - base missing/);
  });
});
