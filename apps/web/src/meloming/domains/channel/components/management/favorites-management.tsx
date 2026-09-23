"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Star, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { ManagementHeader } from "./management-header";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { useChannelFavoriteUsers } from "@/meloming/domains/channel/hooks/use-favorites";
import UserAvatar from "../channel/user-avatar";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/meloming/shared/components/ui/pagination";
import type { FavoriteUserItem } from "@/meloming/domains/channel/types/favorite";
import { Button } from "@/meloming/shared/components/ui/button";
import dayjs from "dayjs";

const ITEMS_PER_PAGE = 20;

const columnHelper = createColumnHelper<FavoriteUserItem>();

const columns = [
  columnHelper.accessor("nickname", {
    id: "user",
    size: 400,
    enableSorting: true,
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
          onClick={() => column.toggleSorting(sorted === "asc")}
        >
          <span className="font-medium">유저</span>
          {sorted === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : sorted === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
          )}
        </Button>
      );
    },
    cell: ({ row }) => {
      const user = row.original;
      return (
        <div className="flex items-center gap-3">
          <UserAvatar
            userName={user.nickname}
            profileImageUrl={user.profileImageUrl}
            className="w-10 h-10 rounded-full object-cover"
            fallbackStyle={{ color: "var(--foreground)" }}
          />
          <div className="font-medium">{user.nickname}</div>
        </div>
      );
    },
  }),
  columnHelper.accessor("createdAt", {
    size: 150,
    enableSorting: true,
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8 data-[state=open]:bg-accent"
          onClick={() => column.toggleSorting(sorted === "asc")}
        >
          <span className="font-medium">즐겨찾기 날짜</span>
          {sorted === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : sorted === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
          )}
        </Button>
      );
    },
    cell: ({ getValue }) => {
      const date = getValue();
      return (
        <span className="text-sm text-muted-foreground">
          {dayjs(date).format("YYYY년 M월 D일")}
        </span>
      );
    },
  }),
];

export function FavoritesManagement() {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";
  const { data: publicUser } = useChannel(username);
  const channelId = publicUser?.id ?? 0;

  const { data: userPermission } = useChannelPermission(username);

  const [currentPage, setCurrentPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

  const { data, isLoading, error, refetch } = useChannelFavoriteUsers(
    channelId,
    { page: currentPage, limit: ITEMS_PER_PAGE },
    { enabled: channelId > 0 }
  );

  const users = data?.users ?? [];
  const totalPages = data?.totalPages ?? 1;

  const table = useReactTable({
    data: users,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    getRowId: (row) => String(row.userId),
  });

  // 권한 확인: 소유자만
  if (userPermission && !userPermission.isOwner) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="즐겨찾기한 유저"
          description="채널을 즐겨찾기한 유저 목록을 확인할 수 있습니다."
          icon={Star}
        />

        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed text-muted-foreground text-center">
          접근 권한이 없습니다.
          <br />
          (채널 소유자만 접근 가능합니다)
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="즐겨찾기한 유저"
          description="채널을 즐겨찾기한 유저 목록을 확인할 수 있습니다."
          icon={Star}
        />
        <InlineError
          message="즐겨찾기 유저 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="즐겨찾기한 유저"
        description={`채널을 즐겨찾기한 유저 목록입니다. (총 ${
          data?.total ?? 0
        }명)`}
        icon={Star}
      />

      {isLoading ? (
        <div className="rounded-md border">
          <div className="h-12 bg-muted/50" />
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-16 border-t bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : users && users.length > 0 ? (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="bg-muted/50">
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{
                          width: header.getSize(),
                          minWidth: header.getSize(),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.getSize(),
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      className={
                        currentPage === 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((page) => {
                      return (
                        page === 1 ||
                        page === totalPages ||
                        Math.abs(page - currentPage) <= 1
                      );
                    })
                    .map((page, index, array) => {
                      const showEllipsisBefore =
                        index > 0 && page - array[index - 1] > 1;

                      return (
                        <span key={page}>
                          {showEllipsisBefore && (
                            <PaginationItem>
                              <PaginationEllipsis />
                            </PaginationItem>
                          )}
                          <PaginationItem>
                            <PaginationLink
                              onClick={() => setCurrentPage(page)}
                              isActive={currentPage === page}
                              className="cursor-pointer"
                            >
                              {page}
                            </PaginationLink>
                          </PaginationItem>
                        </span>
                      );
                    })}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() =>
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                      }
                      className={
                        currentPage === totalPages
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Star className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              아직 즐겨찾기한 유저가 없습니다
            </h3>
            <p className="text-muted-foreground text-center">
              채널을 즐겨찾기한 유저가 나타나면 여기에 표시됩니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
