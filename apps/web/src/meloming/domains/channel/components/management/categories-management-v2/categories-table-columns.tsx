import { createColumnHelper } from "@tanstack/react-table";
import type { Category } from "@/meloming/domains/channel/types/category";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { Checkbox } from "@/meloming/shared/components/ui/checkbox";
import { Pencil, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import dayjs from "dayjs";

const columnHelper = createColumnHelper<Category>();

interface ColumnOptions {
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onMoveUp: (category: Category) => void;
  onMoveDown: (category: Category) => void;
  isFirst: (category: Category) => boolean;
  isLast: (category: Category) => boolean;
  showPrice: boolean;
  currencyUnit: string;
  currencyConfigs?: Array<{ key: string; unit: string }>;
}

function formatCategoryPrice(
  category: Category,
  currencyConfigs: Array<{ key: string; unit: string }> | undefined,
  currencyUnit: string
): string | null {
  const currencyPrices = category.currencyPrices ?? null;
  const configs = currencyConfigs ?? [];

  if (currencyPrices && Object.keys(currencyPrices).length > 0) {
    const byConfigOrder = configs
      .map((config) => {
        const amount = currencyPrices[config.key];
        if (amount == null) {
          return null;
        }
        return `${amount.toLocaleString()} ${config.unit}`;
      })
      .filter((value): value is string => Boolean(value));

    if (byConfigOrder.length > 0) {
      return byConfigOrder.join(" / ");
    }

    const fallback = Object.entries(currencyPrices)
      .map(([key, amount]) => {
        if (amount == null) {
          return null;
        }
        return `${amount.toLocaleString()} ${key}`;
      })
      .filter((value): value is string => Boolean(value));

    if (fallback.length > 0) {
      return fallback.join(" / ");
    }
  }

  if (category.price != null) {
    return `${category.price.toLocaleString()}${currencyUnit ? ` ${currencyUnit}` : ""}`;
  }

  return null;
}

export const createCategoriesTableColumns = ({
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  showPrice,
  currencyUnit,
  currencyConfigs,
}: ColumnOptions) => [
  // 선택 체크박스
  columnHelper.display({
    id: "select",
    size: 40,
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="전체 선택"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="행 선택"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),

  // 카테고리 (색상 + 이름)
  columnHelper.accessor("name", {
    size: 200,
    header: () => <span className="font-medium">카테고리</span>,
    cell: ({ row }) => {
      const category = row.original;
      return (
        <Badge
          className="text-sm px-2.5 py-1"
          style={{
            backgroundColor: category.color,
            color: getContrastingTextColor(category.color),
          }}
        >
          {category.name}
        </Badge>
      );
    },
    enableSorting: false,
  }),

  // 노래 수
  columnHelper.accessor("songCount", {
    size: 100,
    header: () => <span className="font-medium">노래 수</span>,
    cell: ({ getValue }) => {
      const count = getValue() ?? 0;
      return <span className="text-sm text-muted-foreground">{count}개</span>;
    },
    enableSorting: false,
  }),

  // 가격 (조건부)
  ...(showPrice
    ? [
        columnHelper.display({
          id: "price",
          size: 120,
          header: () => <span className="font-medium">참고 가격</span>,
          cell: ({ row }) => {
            const label = formatCategoryPrice(
              row.original,
              currencyConfigs,
              currencyUnit
            );
            if (!label) {
              return <span className="text-muted-foreground">미설정</span>;
            }
            return <span className="text-sm">{label}</span>;
          },
          enableSorting: false,
        }),
      ]
    : []),

  // 등록일
  columnHelper.accessor("createdAt", {
    size: 120,
    header: () => <span className="font-medium">등록일</span>,
    cell: ({ getValue }) => {
      const date = getValue();
      return (
        <span className="text-sm text-muted-foreground">
          {dayjs(date).format("YYYY.MM.DD")}
        </span>
      );
    },
    enableSorting: false,
  }),

  // 순서 변경
  columnHelper.display({
    id: "order",
    size: 80,
    header: () => <span className="font-medium">순서</span>,
    cell: ({ row }) => {
      const category = row.original;
      const isFirstItem = isFirst(category);
      const isLastItem = isLast(category);

      return (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="위로"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp(category);
            }}
            disabled={isFirstItem}
          >
            <ChevronUp className="h-4 w-4" />
            <span className="sr-only">위로</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="아래로"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown(category);
            }}
            disabled={isLastItem}
          >
            <ChevronDown className="h-4 w-4" />
            <span className="sr-only">아래로</span>
          </Button>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  }),

  // 액션
  columnHelper.display({
    id: "actions",
    size: 100,
    header: "",
    cell: ({ row }) => {
      const category = row.original;
      return (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="수정"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(category);
            }}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">수정</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="삭제"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(category);
            }}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">삭제</span>
          </Button>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  }),
];
