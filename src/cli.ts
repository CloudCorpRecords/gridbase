#!/usr/bin/env node
/**
 * gridbase CLI.
 *
 *   gridbase bases
 *   gridbase tables <baseId> [--detail full|identifiersOnly|tableIdentifiersOnly]
 *   gridbase describe <baseId> <tableId> [--detail level]
 *   gridbase records <baseId> <tableId> [--max n] [--filter formula]
 *   gridbase search <baseId> <tableId> <term> [--fields a,b] [--max n]
 *   gridbase get <baseId> <tableId> <recordId>
 *   gridbase create <baseId> <tableId> <fields-json>
 *   gridbase update <baseId> <tableId> <records-json>
 *   gridbase delete <baseId> <tableId> <recordId>...
 *   gridbase create-table <baseId> <name> <fields-json> [--description text]
 *   gridbase update-table <baseId> <tableId> [--name n] [--description text]
 *   gridbase create-field <baseId> <tableId> <name> <type> [--description text]
 *   gridbase update-field <baseId> <tableId> <fieldId> [--name n] [--description text]
 *   gridbase comment <baseId> <tableId> <recordId> <text> [--parent id]
 *   gridbase comments <baseId> <tableId> <recordId> [--page-size n] [--offset s]
 *   gridbase mcp
 *
 * Reads the Airtable token from AIRTABLE_API_KEY.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  API_KEY_ENV,
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

function usage(): never {
  console.error(`Usage:
  gridbase bases
  gridbase tables <baseId> [--detail level]
  gridbase describe <baseId> <tableId> [--detail level]
  gridbase records <baseId> <tableId> [--max n] [--filter formula]
  gridbase search <baseId> <tableId> <term> [--fields a,b] [--max n]
  gridbase get <baseId> <tableId> <recordId>
  gridbase create <baseId> <tableId> <fields-json>
  gridbase update <baseId> <tableId> <records-json>
  gridbase delete <baseId> <tableId> <recordId>...
  gridbase create-table <baseId> <name> <fields-json> [--description text]
  gridbase update-table <baseId> <tableId> [--name n] [--description text]
  gridbase create-field <baseId> <tableId> <name> <type> [--description text]
  gridbase update-field <baseId> <tableId> <fieldId> [--name n] [--description text]
  gridbase comment <baseId> <tableId> <recordId> <text> [--parent id]
  gridbase comments <baseId> <tableId> <recordId> [--page-size n] [--offset s]
  gridbase mcp
  gridbase --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function withoutFlags(args: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++;
    else out.push(args[i]);
  }
  return out;
}

function numFlag(args: string[], name: string): number | undefined {
  const raw = flagValue(args, name);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) usage();
  try {
    return JSON.parse(raw as string);
  } catch {
    console.error("error: argument is not valid JSON");
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const apiKey = process.env[API_KEY_ENV];
  const known = [
    "bases", "tables", "describe", "records", "search", "get", "create",
    "update", "delete", "create-table", "update-table", "create-field",
    "update-field", "comment", "comments",
  ];
  if (!known.includes(cmd)) usage();
  try {
    let out: unknown;
    if (cmd === "bases") {
      out = await listBases(fetchFn, apiKey);
    } else if (cmd === "tables") {
      const pos = withoutFlags(rest, ["--detail"]);
      if (!pos[0]) usage();
      out = await listTables(fetchFn, apiKey, { baseId: pos[0], detailLevel: flagValue(rest, "--detail") });
    } else if (cmd === "describe") {
      const pos = withoutFlags(rest, ["--detail"]);
      if (!pos[0] || !pos[1]) usage();
      out = await describeTable(fetchFn, apiKey, { baseId: pos[0], tableId: pos[1], detailLevel: flagValue(rest, "--detail") });
    } else if (cmd === "records") {
      const pos = withoutFlags(rest, ["--max", "--filter"]);
      if (!pos[0] || !pos[1]) usage();
      out = await listRecords(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        maxRecords: numFlag(rest, "--max"),
        filterByFormula: flagValue(rest, "--filter"),
      });
    } else if (cmd === "search") {
      const pos = withoutFlags(rest, ["--fields", "--max"]);
      if (!pos[0] || !pos[1] || !pos[2]) usage();
      const fieldsRaw = flagValue(rest, "--fields");
      out = await searchRecords(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        searchTerm: pos.slice(2).join(" "),
        fieldIds: fieldsRaw ? fieldsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        maxRecords: numFlag(rest, "--max"),
      });
    } else if (cmd === "get") {
      if (!rest[0] || !rest[1] || !rest[2]) usage();
      out = await getRecord(fetchFn, apiKey, { baseId: rest[0], tableId: rest[1], recordId: rest[2] });
    } else if (cmd === "create") {
      if (!rest[0] || !rest[1]) usage();
      out = await createRecord(fetchFn, apiKey, {
        baseId: rest[0],
        tableId: rest[1],
        fields: parseJson(rest[2]) as Record<string, unknown>,
      });
    } else if (cmd === "update") {
      if (!rest[0] || !rest[1]) usage();
      out = await updateRecords(fetchFn, apiKey, {
        baseId: rest[0],
        tableId: rest[1],
        records: parseJson(rest[2]) as { id: string; fields: Record<string, unknown> }[],
      });
    } else if (cmd === "delete") {
      if (!rest[0] || !rest[1] || rest.length < 3) usage();
      out = await deleteRecords(fetchFn, apiKey, { baseId: rest[0], tableId: rest[1], recordIds: rest.slice(2) });
    } else if (cmd === "create-table") {
      const pos = withoutFlags(rest, ["--description"]);
      if (!pos[0] || !pos[1]) usage();
      out = await createTable(fetchFn, apiKey, {
        baseId: pos[0],
        name: pos[1],
        description: flagValue(rest, "--description"),
        fields: parseJson(pos[2]) as never[],
      });
    } else if (cmd === "update-table") {
      const pos = withoutFlags(rest, ["--name", "--description"]);
      if (!pos[0] || !pos[1]) usage();
      out = await updateTable(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        name: flagValue(rest, "--name"),
        description: flagValue(rest, "--description"),
      });
    } else if (cmd === "create-field") {
      const pos = withoutFlags(rest, ["--description"]);
      if (!pos[0] || !pos[1] || !pos[2] || !pos[3]) usage();
      out = await createField(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        name: pos[2],
        type: pos[3],
        description: flagValue(rest, "--description"),
      });
    } else if (cmd === "update-field") {
      const pos = withoutFlags(rest, ["--name", "--description"]);
      if (!pos[0] || !pos[1] || !pos[2]) usage();
      out = await updateField(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        fieldId: pos[2],
        name: flagValue(rest, "--name"),
        description: flagValue(rest, "--description"),
      });
    } else if (cmd === "comment") {
      const pos = withoutFlags(rest, ["--parent"]);
      if (!pos[0] || !pos[1] || !pos[2] || !pos[3]) usage();
      out = await createComment(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        recordId: pos[2],
        text: pos.slice(3).join(" "),
        parentCommentId: flagValue(rest, "--parent"),
      });
    } else {
      const pos = withoutFlags(rest, ["--page-size", "--offset"]);
      if (!pos[0] || !pos[1] || !pos[2]) usage();
      out = await listComments(fetchFn, apiKey, {
        baseId: pos[0],
        tableId: pos[1],
        recordId: pos[2],
        pageSize: numFlag(rest, "--page-size"),
        offset: flagValue(rest, "--offset"),
      });
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
