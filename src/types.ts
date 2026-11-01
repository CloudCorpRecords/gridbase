/**
 * gridbase types.
 *
 * Shapes follow the public Airtable Web API: a base holds tables, a
 * table holds fields, views, and records, and a record is an ID plus a
 * free-form fields object. Write tools pass field values through as the
 * caller supplied them. HTTP access is described by a minimal response
 * surface so tests can inject a fake fetch and never touch the network.
 */

export type DetailLevel = "tableIdentifiersOnly" | "identifiersOnly" | "full";

export interface ListTablesOptions {
  baseId: string;
  detailLevel?: string;
}

export interface DescribeTableOptions {
  baseId: string;
  tableId: string;
  detailLevel?: string;
}

export interface ListRecordsOptions {
  baseId: string;
  tableId: string;
  maxRecords?: number;
  filterByFormula?: string;
}

export interface SearchRecordsOptions {
  baseId: string;
  tableId: string;
  searchTerm: string;
  fieldIds?: string[];
  maxRecords?: number;
}

export interface GetRecordOptions {
  baseId: string;
  tableId: string;
  recordId: string;
}

export interface CreateRecordOptions {
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
}

export interface UpdateRecordsOptions {
  baseId: string;
  tableId: string;
  records: { id: string; fields: Record<string, unknown> }[];
}

export interface DeleteRecordsOptions {
  baseId: string;
  tableId: string;
  recordIds: string[];
}

export interface FieldDefinition {
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface CreateTableOptions {
  baseId: string;
  name: string;
  description?: string;
  fields: FieldDefinition[];
}

export interface UpdateTableOptions {
  baseId: string;
  tableId: string;
  name?: string;
  description?: string;
}

export interface CreateFieldOptions {
  baseId: string;
  tableId: string;
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface UpdateFieldOptions {
  baseId: string;
  tableId: string;
  fieldId: string;
  name?: string;
  description?: string;
}

export interface CreateCommentOptions {
  baseId: string;
  tableId: string;
  recordId: string;
  text: string;
  parentCommentId?: string;
}

export interface ListCommentsOptions {
  baseId: string;
  tableId: string;
  recordId: string;
  pageSize?: number;
  offset?: string;
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
