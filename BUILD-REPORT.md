# gridbase — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the Airtable MCP
server (domdomegg/airtable-mcp-server), built from the public tool
spec captured in `harness/fixtures/airtable-tools-original.json`
only. The fixture was created for this build from the original
project's public README (Components / Tools section, fetched
2026-10-26), marked `"_source": docs-derived ... not hand-probed`.

**Spec deviation from the program brief (flagged, not hidden):** the
brief's starting point listed 9 tools with singular write names
(`update_record`, `delete_record`). The current public docs list
**15 tools**: the write tools are plural (`update_records`,
`delete_records`), and the docs add `create_table`, `update_table`,
`create_field`, `update_field`, `create_comment`, and
`list_comments`. Per the build instructions ("if docs show a
different set, use docs and note it"), gridbase implements the
documented 15. Local build only — nothing pushed or published, and
no live network call was made or claimed at any point.

Identity: repo `gridbase`, npm `@reneturcios/gridbase`,
MCP name `io.github.CloudCorpRecords/gridbase`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `gridbase: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Bases, tables, and records in
  Airtable: list, search, create, update, delete." = **77 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/gridbase:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/gridbase"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`bases`, `tables`, `describe`,
  `records`, `search`, `get`, `create`, `update`, `delete`,
  `create-table`, `update-table`, `create-field`, `update-field`,
  `comment`, `comments`, `mcp`, `--version`; exit 2 usage / 1 API
  error), `src/mcp.ts`, `src/types.ts`, `src/airtable.ts` (core
  logic, `VERSION = "0.1.0"`)
- `test/airtable.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to gridbase)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the public spec and
  break exact schema parity. Zod still validates every `tools/call`.
- The fifteen tools map to the Airtable Web API under
  `https://api.airtable.com/v0`: meta endpoints for bases/tables/
  fields (`/meta/bases`, `/meta/bases/{base}/tables[/{table}[/fields
  [/{field}]]]`), record endpoints at `/{base}/{table}[/{record}]`
  (GET list/one, POST create, PATCH update with a `{records}` body,
  DELETE with repeated `records[]` params), and comments at
  `/{base}/{table}/{record}/comments`. The token from
  `AIRTABLE_API_KEY` is sent as an `Authorization: Bearer` header;
  base/table/record/field IDs are URL-encoded per segment.
- `describe_table` reads the base's table list and returns only the
  requested table (erroring when absent). Schema reads honour
  `detailLevel` by trimming the meta payload locally:
  `tableIdentifiersOnly` keeps table id/name, `identifiersOnly` also
  reduces fields/views to id/name, `full` returns the payload as-is.
- Airtable has no text-search endpoint, so `search_records` lists the
  table (bounded by `maxRecords`, default 100) and keeps records
  whose string/number field values contain the term
  case-insensitively, restricted to `fieldIds` when given.
- HTTP failures surface the status plus Airtable's own
  `error.type` / `error.message` when the body carries them. A
  missing token throws before any request, with an error naming
  `AIRTABLE_API_KEY`; over MCP this surfaces as an `isError` result
  (verified live over stdio, see below).
- All HTTP flows through an injectable `FetchFn` (types.ts). The test
  suite uses a fake fetch returning hand-written Airtable-shaped JSON
  fixtures — **no live call was performed during this build**.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js` with the
`#!/usr/bin/env node` shebang.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 17
ℹ pass 17
ℹ fail 0
```
Covers: missing/blank token error naming AIRTABLE_API_KEY (and no
request made without a token), meta-bases URL + Bearer header, full /
tableIdentifiersOnly / identifiersOnly detail trimming,
describe_table single-table selection + not-found error + bad
detailLevel rejection, record list URL with `maxRecords` default 100
and `filterByFormula`, table-name URL encoding, single-record GET,
search matching (case-insensitive, fieldIds restriction), create
POST `{fields}` body, update PATCH `{records}` body, delete DELETE
with repeated `records[]`, comment create/list paths and paging, and
HTTP-404 errors carrying Airtable's error type and message.

### 3. CLI / MCP smoke
`--version` → `0.1.0`; unknown command exits 2 with Usage. MCP
`initialize` over stdio → `serverInfo: {"name":"gridbase",
"version":"0.1.0"}`. A `tools/call` for `list_bases` with
`AIRTABLE_API_KEY` unset returned `isError: true` with text
"AIRTABLE_API_KEY environment variable is required: set
AIRTABLE_API_KEY to an Airtable personal access token and retry".
CLI calls against the live API were **not** run (offline build rule
for this wave).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/airtable-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/gridbase/dist/cli.js mcp" \
    --out .../builds/gridbase/parity-out
verdict=PASS parity_pct=100.0 original_tools=15 rebuild_tools=15 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Original side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from searchport's and edited with the
file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed searchport -> gridbase (dependency ranges
are identical, so the tree is unchanged). **Clean lockfile regen
required before publish** (regenerate with no `node_modules`
present); do not publish from this lockfile as-is. `node_modules`
here is a `cp -a` copy of searchport's; `.bin/tsc` / `.bin/tsx`
verified working.

## Gaps / honest notes

- Tool-set deviation from the brief: 15 documented tools implemented
  instead of the brief's 9 (see the top of this report). If the
  coordinator wants the older 9-tool surface instead, the fixture and
  the six extra tools are the delta.
- No live Airtable call was made (VM egress is blocked and no token
  is available in this environment). Request construction is written
  against the documented Web API paths and payload shapes; live
  payload drift is unverified until the publish wave can smoke with
  a real token. Behaviour parity is tool/schema + docs-contract, not
  live-proven.
- `search_records` field matching keys records by field ID as stored
  in the API payload's `fields` object; when a caller passes field
  *names* in `fieldIds` against an ID-keyed payload (Airtable returns
  names by default unless `returnFieldsByFieldId` is set), matching
  falls back to no hits for those fields — a live-smoke check item.
- `fieldIds` in the documented spec are described as "field IDs to
  search in"; the upstream implementation detail (which endpoint
  shape it uses) is not public in the README, so the local-match
  reproduction is a contract-level equivalent, not a wire-identical
  one.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`, following the standing Wave 2 remediation
pattern. This is an authorized deviation from the parity-faithful
state: descriptions were added to every tool parameter that lacked
one, in the `src/mcp.ts` schema literals only — parameter names,
types and required lists are unchanged.

- Descriptions added: 55 insertion points, covering 55 served parameter
  occurrences (no shared schema consts in this unit's `TOOLS` literals;
  each insertion serves exactly one occurrence). Insertion points, by
  tool: `list_tables` parameters `baseId`, `detailLevel`;
  `describe_table` parameters `baseId`, `tableId`, `detailLevel`;
  `list_records` parameters `baseId`, `tableId`, `maxRecords`,
  `filterByFormula`; `search_records` parameters `baseId`, `tableId`,
  `searchTerm`, `fieldIds`, `maxRecords`; `get_record` parameters
  `baseId`, `tableId`, `recordId`; `create_record` parameters
  `baseId`, `tableId`, `fields`; `update_records` parameters
  `baseId`, `tableId`, `records`; `delete_records` parameters
  `baseId`, `tableId`, `recordIds`; `create_table` parameters
  `baseId`, `name`, `description`, `fields`; `update_table`
  parameters `baseId`, `tableId`, `name`, `description`;
  `create_field` parameters `baseId`, `tableId`, `name`, `type`,
  `description`, `options`; `update_field` parameters `baseId`,
  `tableId`, `fieldId`, `name`, `description`; `create_comment`
  parameters `baseId`, `tableId`, `recordId`, `text`,
  `parentCommentId`; and `list_comments` parameters `baseId`,
  `tableId`, `recordId`, `pageSize`, `offset`. The `list_bases` tool
  has no parameters. This covers all 14 PARAMS_UNDESCRIBED audit
  issues in `publish/regate/gridbase-mcpaudit.json`; the info-level
  SCHEMA_NO_PROPERTIES finding on `list_bases` needed no action.
- Rebuild: `npm run build` exit 0; `npx tsc --noEmit` exit 0; full
  test suite 17/17 pass (tests 17, pass 17, fail 0).
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 53.3** —
  original_tools=15 rebuild_tools=15 missing=[] extra=[]
  schema_diffs=['create_comment', 'create_field', 'create_record',
  'create_table', 'delete_records', 'describe_table', 'get_record',
  'list_comments', 'list_records', 'list_tables', 'search_records',
  'update_field', 'update_records', 'update_table']. Every one of
  the 55 schema diffs is a description addition
  (`*.description: present in rebuild but not in original`); 0
  structural diffs. Structural parity proven independently:
  stripping `description` keys from BOTH the pre- and
  post-remediation tools/list deep-equals (strip-proof RESULT: PASS;
  every description present in PRE is byte-identical in POST, and
  the only additions are at inputSchema property paths — 55
  additions, 0 removals). Counting note: four tools have a parameter
  literally named `description` (`create_table`, `update_table`,
  `create_field`, `update_field`); those are counted by their added
  nested string description at
  `.../properties/description/description`, and the strip removes
  those four property entries from both sides equally, with parity
  classifying their diffs as description additions only.
  Adjudication: the description-only diff is the authorized
  remediation itself; structural parity is unchanged. Full record:
  `publish/parity-remediation/gridbase/parity.json` and
  `publish/parity-remediation/gridbase/strip-proof.txt`.
- No publish gate was run in this remediation (no mcpaudit/mcpvet),
  and nothing was published.
