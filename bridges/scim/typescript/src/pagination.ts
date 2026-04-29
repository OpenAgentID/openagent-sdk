/**
 * SCIM pagination — RFC 7644 section 3.4.2.4.
 *
 * SCIM uses 1-based indexing. `startIndex` defaults to 1 if omitted.
 * `count` is capped to the configured `maxPageSize`.
 */

import { type ScimListResponse, SCIM_LIST_RESPONSE_SCHEMA } from './schemas.js';

/** Parsed pagination parameters from a SCIM request. */
export interface PaginationParams {
  /** 1-based start index. */
  readonly startIndex: number;
  /** Number of results to return. */
  readonly count: number;
}

/**
 * Extract pagination parameters from a SCIM request URL search params.
 *
 * Returns immutable params — never mutates the input.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  maxPageSize: number,
): PaginationParams {
  const rawStart = searchParams.get('startIndex');
  const rawCount = searchParams.get('count');

  const startIndex = rawStart !== null ? Math.max(1, Math.floor(Number(rawStart))) : 1;
  const requestedCount = rawCount !== null ? Math.floor(Number(rawCount)) : maxPageSize;
  const count = Math.min(Math.max(0, requestedCount), maxPageSize);

  return { startIndex, count };
}

/**
 * Apply pagination to an array of items and return a SCIM ListResponse.
 *
 * Items are expected to be pre-filtered and pre-sorted. This function
 * slices the array according to 1-based SCIM indexing.
 */
export function paginateResults<T>(
  items: readonly T[],
  params: PaginationParams,
): ScimListResponse<T> {
  const totalResults = items.length;
  // SCIM startIndex is 1-based; convert to 0-based offset
  const offset = params.startIndex - 1;
  const page = items.slice(offset, offset + params.count);

  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex: params.startIndex,
    itemsPerPage: page.length,
    Resources: page,
  };
}
