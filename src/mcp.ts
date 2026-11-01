/**
 * gridbase MCP server. Tools: list_bases, list_tables, describe_table,
 * list_records, search_records, get_record, create_record,
 * update_records, delete_records, create_table, update_table,
 * create_field, update_field, create_comment, list_comments.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set. Tool names,
 * parameters, and required sets are taken from the public spec.
 *
 * The Airtable token is read from AIRTABLE_API_KEY at call time; a
 * missing key returns an honest isError result naming the variable
 * instead of failing the handshake.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createComment,
  createField,
  createRecord,
  createTable,
  deleteRecords,
  describeTable,
  formatPayload,
  getRecord,
  listBases,
  listComments,
  listRecords,
  listTables,
  searchRecords,
  updateField,
  updateRecords,
  updateTable,
  VERSION,
} from "./airtable.js";
import type { FetchFn } from "./types.js";

const NoArgs = z.object({});
const ListTablesArgs = z.object({
  baseId: z.string(),
  detailLevel: z.string().optional(),
});
const DescribeTableArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  detailLevel: z.string().optional(),
});
const ListRecordsArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  maxRecords: z.number().optional(),
  filterByFormula: z.string().optional(),
});
const SearchRecordsArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  searchTerm: z.string(),
  fieldIds: z.array(z.string()).optional(),
  maxRecords: z.number().optional(),
});
const GetRecordArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
});
const CreateRecordArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
const UpdateRecordsArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  records: z.array(
    z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) }),
  ),
});
const DeleteRecordsArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordIds: z.array(z.string()),
});
const FieldDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const CreateTableArgs = z.object({
  baseId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  fields: z.array(FieldDefinitionSchema),
});
const UpdateTableArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});
const CreateFieldArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const UpdateFieldArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fieldId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
});
const CreateCommentArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  text: z.string(),
  parentCommentId: z.string().optional(),
});
const ListCommentsArgs = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  pageSize: z.number().optional(),
  offset: z.string().optional(),
});

const TOOLS = [
  {
    name: "list_bases",
    description: "List every Airtable base the configured token can access, with its ID, name, and permission level.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_tables",
    description: "List the tables in a base, with fields and views at the requested level of detail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base whose tables to list." },
        detailLevel: { type: "string", description: "Level of detail for the returned tables: tableIdentifiersOnly (table ID and name only), identifiersOnly (IDs and names for tables, fields, and views), or full (the complete schema, the default)." },
      },
      required: ["baseId"],
    },
  },
  {
    name: "describe_table",
    description: "Describe one table in a base, returning its fields and views at the requested level of detail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table to describe." },
        tableId: { type: "string", description: "ID or name of the table to describe." },
        detailLevel: { type: "string", description: "Level of detail for the returned table: tableIdentifiersOnly (table ID and name only), identifiersOnly (IDs and names for tables, fields, and views), or full (the complete schema, the default)." },
      },
      required: ["baseId", "tableId"],
    },
  },
  {
    name: "list_records",
    description: "List records from a table, optionally filtered by an Airtable formula.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to list records from." },
        maxRecords: { type: "number", description: "Maximum number of records to return; defaults to 100." },
        filterByFormula: { type: "string", description: "Optional Airtable formula used to filter the records returned." },
      },
      required: ["baseId", "tableId"],
    },
  },
  {
    name: "search_records",
    description: "Search records in a table for a text term, across all text fields or a chosen subset.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to search records in." },
        searchTerm: { type: "string", description: "Text term to search for in record field values; matching is case-insensitive." },
        fieldIds: { type: "array", items: { type: "string" }, description: "Optional list of field IDs to restrict the search to; when omitted, all fields are searched." },
        maxRecords: { type: "number", description: "Maximum number of records to search through; defaults to 100." },
      },
      required: ["baseId", "tableId", "searchTerm"],
    },
  },
  {
    name: "get_record",
    description: "Fetch a single record from a table by its record ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table containing the record." },
        recordId: { type: "string", description: "ID of the record to fetch." },
      },
      required: ["baseId", "tableId", "recordId"],
    },
  },
  {
    name: "create_record",
    description: "Create a new record in a table from a set of field values.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to create the record in." },
        fields: { type: "object", description: "Object of field values for the new record, keyed by field name or ID." },
      },
      required: ["baseId", "tableId", "fields"],
    },
  },
  {
    name: "update_records",
    description: "Update one or more records in a table, setting the given fields on each.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table containing the records to update." },
        records: { type: "array", items: { type: "object" }, description: "Array of records to update, each an object with an id and a fields object of values to set." },
      },
      required: ["baseId", "tableId", "records"],
    },
  },
  {
    name: "delete_records",
    description: "Delete one or more records from a table by their record IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to delete records from." },
        recordIds: { type: "array", items: { type: "string" }, description: "Array of IDs of the records to delete." },
      },
      required: ["baseId", "tableId", "recordIds"],
    },
  },
  {
    name: "create_table",
    description: "Create a new table in a base with the given name, optional description, and field definitions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base in which to create the table." },
        name: { type: "string", description: "Name for the new table." },
        description: { type: "string", description: "Optional description for the new table." },
        fields: { type: "array", items: { type: "object" }, description: "Array of field definitions for the new table, each with a name and type and optional description and options." },
      },
      required: ["baseId", "name", "fields"],
    },
  },
  {
    name: "update_table",
    description: "Update a table's name or description.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to update." },
        name: { type: "string", description: "New name for the table." },
        description: { type: "string", description: "New description for the table." },
      },
      required: ["baseId", "tableId"],
    },
  },
  {
    name: "create_field",
    description: "Create a new field in a table with the given name and type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table to add the field to." },
        name: { type: "string", description: "Name for the new field." },
        type: { type: "string", description: "Type of the new field, as an Airtable field type string." },
        description: { type: "string", description: "Optional description for the new field." },
        options: { type: "object", description: "Optional options object for the field type, such as choices for a select field." },
      },
      required: ["baseId", "tableId", "name", "type"],
    },
  },
  {
    name: "update_field",
    description: "Update a field's name or description.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table containing the field to update." },
        fieldId: { type: "string", description: "ID of the field to update." },
        name: { type: "string", description: "New name for the field." },
        description: { type: "string", description: "New description for the field." },
      },
      required: ["baseId", "tableId", "fieldId"],
    },
  },
  {
    name: "create_comment",
    description: "Add a comment to a record, optionally as a reply to an existing comment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table containing the record to comment on." },
        recordId: { type: "string", description: "ID of the record to add the comment to." },
        text: { type: "string", description: "Text of the comment." },
        parentCommentId: { type: "string", description: "Optional ID of an existing comment to reply to." },
      },
      required: ["baseId", "tableId", "recordId", "text"],
    },
  },
  {
    name: "list_comments",
    description: "List the comments on a record, newest first, with pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        baseId: { type: "string", description: "ID of the Airtable base containing the table." },
        tableId: { type: "string", description: "ID of the table containing the record." },
        recordId: { type: "string", description: "ID of the record whose comments to list." },
        pageSize: { type: "number", description: "Maximum number of comments to return per page (1 to 100)." },
        offset: { type: "string", description: "Optional pagination offset returned by a previous list_comments call, to fetch the next page." },
      },
      required: ["baseId", "tableId", "recordId"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "gridbase", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env.AIRTABLE_API_KEY;
  try {
    let out: unknown;
    if (name === "list_bases") {
      NoArgs.parse(args ?? {});
      out = await listBases(fetchFn, apiKey);
    } else if (name === "list_tables") {
      out = await listTables(fetchFn, apiKey, ListTablesArgs.parse(args ?? {}));
    } else if (name === "describe_table") {
      out = await describeTable(fetchFn, apiKey, DescribeTableArgs.parse(args ?? {}));
    } else if (name === "list_records") {
      out = await listRecords(fetchFn, apiKey, ListRecordsArgs.parse(args ?? {}));
    } else if (name === "search_records") {
      out = await searchRecords(fetchFn, apiKey, SearchRecordsArgs.parse(args ?? {}));
    } else if (name === "get_record") {
      out = await getRecord(fetchFn, apiKey, GetRecordArgs.parse(args ?? {}));
    } else if (name === "create_record") {
      out = await createRecord(fetchFn, apiKey, CreateRecordArgs.parse(args ?? {}));
    } else if (name === "update_records") {
      out = await updateRecords(fetchFn, apiKey, UpdateRecordsArgs.parse(args ?? {}));
    } else if (name === "delete_records") {
      out = await deleteRecords(fetchFn, apiKey, DeleteRecordsArgs.parse(args ?? {}));
    } else if (name === "create_table") {
      out = await createTable(fetchFn, apiKey, CreateTableArgs.parse(args ?? {}));
    } else if (name === "update_table") {
      out = await updateTable(fetchFn, apiKey, UpdateTableArgs.parse(args ?? {}));
    } else if (name === "create_field") {
      out = await createField(fetchFn, apiKey, CreateFieldArgs.parse(args ?? {}));
    } else if (name === "update_field") {
      out = await updateField(fetchFn, apiKey, UpdateFieldArgs.parse(args ?? {}));
    } else if (name === "create_comment") {
      out = await createComment(fetchFn, apiKey, CreateCommentArgs.parse(args ?? {}));
    } else if (name === "list_comments") {
      out = await listComments(fetchFn, apiKey, ListCommentsArgs.parse(args ?? {}));
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
