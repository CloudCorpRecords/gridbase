# gridbase

gridbase is a workbench for Airtable. It walks a base the way a person
would: first the list of bases a token can reach, then the tables
inside one base and the fields and views each table declares, then the
records themselves — listed, filtered by formula, searched by text, or
fetched one at a time. The same surface writes back: records can be
created, updated, and deleted, tables and fields can be created and
renamed, and comments can be attached to records and read again. One
binary serves a command-line interface and a stdio MCP server.

An Airtable personal access token is required. Put it in the
`AIRTABLE_API_KEY` environment variable; it is sent to the API as an
`Authorization: Bearer` header and never appears in output. When the
variable is missing, every call fails with an error that names it,
before any request is made. The token needs the `schema.bases:read`
and `data.records:read` scopes at minimum, plus the matching write
scopes for the write tools.

## Install

```bash
npx @reneturcios/gridbase bases
```

Or run the container image:

```bash
docker run -i -e AIRTABLE_API_KEY ghcr.io/cloudcorprecords/gridbase
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
export AIRTABLE_API_KEY="pat..."

gridbase bases
gridbase tables appXXXXXXXXXXXXXX --detail full
gridbase describe appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX
gridbase records appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX --max 25 --filter "{Status}='Open'"
gridbase search appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX "quarterly report"
gridbase get appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX recXXXXXXXXXXXXXX
gridbase create appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX '{"Name":"New task","Status":"Open"}'
gridbase update appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX '[{"id":"recXXXXXXXXXXXXXX","fields":{"Status":"Done"}}]'
gridbase delete appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX recXXXXXXXXXXXXXX
gridbase create-table appXXXXXXXXXXXXXX Reports '[{"name":"Title","type":"singleLineText"}]'
gridbase comment appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX recXXXXXXXXXXXXXX "Looks good"
gridbase comments appXXXXXXXXXXXXXX tblXXXXXXXXXXXXXX recXXXXXXXXXXXXXX --page-size 10

gridbase --version
```

Each command prints the upstream JSON payload. Exit codes: `0` on
success, `1` when a call fails (including a missing `AIRTABLE_API_KEY`
or an API error), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/gridbase mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "gridbase": {
      "command": "npx",
      "args": ["-y", "@reneturcios/gridbase", "mcp"],
      "env": { "AIRTABLE_API_KEY": "pat..." }
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `list_bases` | (none) | Every accessible base with its ID, name, and permission level. |
| `list_tables` | `baseId` (required), `detailLevel` (optional) | Tables in the base, trimmed to the requested detail level. |
| `describe_table` | `baseId`, `tableId` (required), `detailLevel` (optional) | One table's fields and views. |
| `list_records` | `baseId`, `tableId` (required), `maxRecords`, `filterByFormula` (optional) | Records from the table. |
| `search_records` | `baseId`, `tableId`, `searchTerm` (required), `fieldIds`, `maxRecords` (optional) | Records whose field values contain the term. |
| `get_record` | `baseId`, `tableId`, `recordId` (required) | The single record. |
| `create_record` | `baseId`, `tableId`, `fields` (required) | The created record. |
| `update_records` | `baseId`, `tableId`, `records` (required) | The updated records. |
| `delete_records` | `baseId`, `tableId`, `recordIds` (required) | Deletion receipts for each record. |
| `create_table` | `baseId`, `name`, `fields` (required), `description` (optional) | The created table. |
| `update_table` | `baseId`, `tableId` (required), `name`, `description` (optional) | The updated table. |
| `create_field` | `baseId`, `tableId`, `name`, `type` (required), `description`, `options` (optional) | The created field. |
| `update_field` | `baseId`, `tableId`, `fieldId` (required), `name`, `description` (optional) | The updated field. |
| `create_comment` | `baseId`, `tableId`, `recordId`, `text` (required), `parentCommentId` (optional) | The created comment. |
| `list_comments` | `baseId`, `tableId`, `recordId` (required), `pageSize`, `offset` (optional) | The record's comments, newest first. |

Airtable offers no text-search endpoint, so `search_records` lists
the table (bounded by `maxRecords`) and keeps the records whose field
values contain the term, restricted to `fieldIds` when supplied.
Schema reads trim the meta payload themselves: `tableIdentifiersOnly`
keeps table IDs and names, `identifiersOnly` also reduces fields and
views to IDs and names, and `full` (the default) returns everything.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
