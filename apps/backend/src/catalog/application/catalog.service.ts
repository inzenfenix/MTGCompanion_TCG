import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../domain/catalog.repository';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
// ROADMAP.md I19/I25 — a rules-text OCR query needs real content before a
// full-table trigram scan against oracleText is worth doing at all; a name
// query's 2-char floor would let through near-nothing here.
const MIN_TEXT_QUERY_LENGTH = 10;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
  ) {}

  search(query: string, limit?: number) {
    const trimmed = query?.trim() ?? '';
    if (trimmed.length < MIN_QUERY_LENGTH) {
      // Same reasoning as debouncing on the client: a 0-1 char query against
      // ~58k rows returns a near-useless wall of matches — reject early
      // instead of doing the scan for nothing.
      throw new BadRequestException(
        `q must be at least ${MIN_QUERY_LENGTH} characters`,
      );
    }
    const clampedLimit = Math.min(
      Math.max(limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    return this.catalog.search(trimmed, clampedLimit);
  }

  searchByText(query: string, limit?: number) {
    const trimmed = query?.trim() ?? '';
    if (trimmed.length < MIN_TEXT_QUERY_LENGTH) {
      throw new BadRequestException(
        `q must be at least ${MIN_TEXT_QUERY_LENGTH} characters`,
      );
    }
    const clampedLimit = Math.min(
      Math.max(limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    return this.catalog.searchByText(trimmed, clampedLimit);
  }
}
