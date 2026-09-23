export interface CommonPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CommonPaginationWithLimit {
  total: number;
  page: number;
  limit: number;
}
