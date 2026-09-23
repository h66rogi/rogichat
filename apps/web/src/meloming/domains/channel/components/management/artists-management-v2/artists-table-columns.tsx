import { createColumnHelper } from "@tanstack/react-table";
import type { Artist } from "@/meloming/domains/channel/types/artist";
import { Button } from "@/meloming/shared/components/ui/button";
import { Checkbox } from "@/meloming/shared/components/ui/checkbox";
import { Pencil, Trash2 } from "lucide-react";
import dayjs from "dayjs";

const columnHelper = createColumnHelper<Artist>();

interface ColumnOptions {
  onEdit: (artist: Artist) => void;
  onDelete: (artist: Artist) => void;
}

export const createArtistsTableColumns = ({
  onEdit,
  onDelete,
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

  // 아티스트 이름
  columnHelper.accessor("name", {
    size: 200,
    header: () => <span className="font-medium">아티스트</span>,
    cell: ({ getValue }) => {
      return <span className="font-medium">{getValue()}</span>;
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

  // 액션
  columnHelper.display({
    id: "actions",
    size: 100,
    header: "",
    cell: ({ row }) => {
      const artist = row.original;
      return (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(artist);
            }}
          >
            <Pencil className="h-4 w-4" />
            <span className="sr-only">수정</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(artist);
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
