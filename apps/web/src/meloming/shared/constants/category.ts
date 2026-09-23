export const DEFAULT_CATEGORY_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#84CC16", // lime
  "#F97316", // orange
  "#EC4899", // pink
  "#6B7280", // gray
];

export type CategoryEditValues = {
  name: string;
  color: string;
  price?: number | null;
  currencyPrices?: Record<string, number | null> | null;
};
