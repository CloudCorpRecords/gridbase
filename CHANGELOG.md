# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `gridbase bases|tables|describe|records|search|get|create|update|delete`
  plus `create-table`, `update-table`, `create-field`, `update-field`,
  `comment`, `comments`, and `gridbase mcp`; the Airtable token is read
  from `AIRTABLE_API_KEY`.
- MCP server (`gridbase mcp`, stdio) with fifteen tools: `list_bases`,
  `list_tables`, `describe_table`, `list_records`, `search_records`,
  `get_record`, `create_record`, `update_records`, `delete_records`,
  `create_table`, `update_table`, `create_field`, `update_field`,
  `create_comment`, and `list_comments`.
- Calls go to the Airtable Web API under `https://api.airtable.com/v0`
  with the token sent as an `Authorization: Bearer` header; HTTP
  failures surface the status plus Airtable's error type and message.
- `search_records` matches text locally over the listed records (the
  API has no search endpoint); schema reads trim the meta payload to
  the requested `detailLevel`.
- A missing `AIRTABLE_API_KEY` fails honestly with an error naming the
  variable, before any request is made.
- All HTTP goes through an injectable fetch function, so the test suite
  runs entirely on hand-written fixtures with no network access.
