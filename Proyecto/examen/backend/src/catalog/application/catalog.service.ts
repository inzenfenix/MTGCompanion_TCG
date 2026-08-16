import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../domain/catalog.repository';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;

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
}
