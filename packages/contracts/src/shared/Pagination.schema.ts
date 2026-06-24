import { z } from "zod";

// Shared bounds for page/perPage pagination that crosses the service boundary:
// gp-api edge schemas forward these params to people-api, which feeds them into
// `LIMIT ${take}` / `OFFSET ${skip}` in raw SQL. Both services must agree on the
// caps, so they live here (per the contracts-are-the-source-of-truth rule).
// MAX_PAGINATION_OFFSET bounds the effective offset ((page - 1) * resultsPerPage)
// so the per-field caps can't combine into a multi-hundred-million-row OFFSET.
export const MAX_RESULTS_PER_PAGE = 10_000;
export const MAX_PAGE = 100_000;
export const MAX_PAGINATION_OFFSET = 1_000_000;

const basePaginationSchema = z.object({
  offset: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const PaginationSchema = () => basePaginationSchema;

export const SortablePaginationSchema = (sortKeys: readonly string[]) => {
  const [first, ...rest] = sortKeys;
  if (!first) {
    throw new Error("sortKeys must contain at least one value");
  }
  return basePaginationSchema.extend({
    sortBy: z.enum([first, ...rest]).optional(),
  });
};

export const paginationFilter = z.string().optional();

export const FilterablePaginationSchema = <F extends z.ZodRawShape>({
  sortKeys,
  filterFields,
}: {
  sortKeys: readonly string[];
  filterFields: F;
}) => SortablePaginationSchema(sortKeys).extend(filterFields);

export const PaginationOptionsSchema = basePaginationSchema.extend({
  sortBy: z.string().optional(),
});

export type PaginationOptions = z.infer<typeof PaginationOptionsSchema>;

export const PaginationMetaSchema = z.object({
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export type PaginatedList<T> = {
  data: T[];
  meta: PaginationMeta;
};
