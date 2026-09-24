"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ScrollText, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ManagementHeader } from "@/meloming/domains/channel/components/management/management-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/meloming/shared/components/ui/table";
import { Button } from "@/meloming/shared/components/ui/button";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/meloming/shared/components/ui/pagination";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import {
  useManageSetlists,
  useUpdateSetlistVisibility,
} from "@/meloming/domains/song-live/hooks/use-setlists";
import type {
  ManageSetlistSummary,
  SetlistVisibility,
} from "@/meloming/domains/song-live/types/setlist";

const ITEMS_PER_PAGE = 20;

const PLATFORM_LABEL: Record<string, string> = {
  CHZZK: "치지직",
  SOOP: "숲",
  CIME: "CIME",
  YOUTUBE: "YouTube",
};

const columnHelper = createColumnHelper<ManageSetlistSummary>();

function VisibilityToggle({
  identifier,
  sessionId,
  visibility,
}: {
  identifier: string;
  sessionId: number;
  visibility: SetlistVisibility;
}) {
  const mutation = useUpdateSetlistVisibility(identifier);
  const isPublic = visibility === "PUBLIC";

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={isPublic}
        disabled={mutation.isPending}
        onCheckedChange={(next) => {
          const nextVisibility: SetlistVisibility = next ? "PUBLIC" : "PRIVATE";
          mutation.mutate(
            { sessionId, visibility: nextVisibility },
            {
              onSuccess: (data) => {
                toast.success(
                  data.visibility === "PUBLIC"
                    ? "셋리스트를 공개로 전환했어요."
                    : "셋리스트를 비공개로 전환했어요."
                );
              },
              onError: () => {
                toast.error("셋리스트 공개 상태 변경에 실패했어요.");
              },
            }
          );
        }}
        aria-label={isPublic ? "공개 → 비공개" : "비공개 → 공개"}
      />
      <span className="text-xs text-muted-foreground">
        {isPublic ? "공개" : "비공개"}
      </span>
    </div>
  );
}

function buildColumns(identifier: string) {
  return [
    columnHelper.accessor("startedAt", {
      id: "startedAt",
      size: 200,
      enableSorting: true,
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            <span className="font-medium">방송 시작</span>
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
        const startedAt = row.original.startedAt;
        return (
          <Link
            href={`/setlist/${row.original.sessionId}`}
            className="flex flex-col group"
            aria-label={`${dayjs(startedAt).format(
              "YYYY-MM-DD HH:mm"
            )} 셋리스트 상세 보기`}
          >
            <span className="font-medium group-hover:underline">
              {dayjs(startedAt).format("YYYY-MM-DD")}
            </span>
            <span className="text-xs text-muted-foreground">
              {dayjs(startedAt).format("HH:mm")}
            </span>
          </Link>
        );
      },
    }),
    columnHelper.accessor("platform", {
      id: "platform",
      size: 100,
      enableSorting: false,
      header: () => <span className="font-medium">플랫폼</span>,
      cell: ({ row }) => {
        const platform = row.original.platform;
        if (!platform) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }
        return (
          <Badge variant="secondary">{PLATFORM_LABEL[platform] ?? platform}</Badge>
        );
      },
    }),
    columnHelper.accessor("durationMinutes", {
      id: "durationMinutes",
      size: 100,
      enableSorting: true,
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            <span className="font-medium">방송 시간</span>
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
        const minutes = getValue();
        if (minutes == null) {
          return <span className="text-muted-foreground text-xs">진행중</span>;
        }
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return (
          <span className="text-sm">
            {h > 0 ? `${h}시간 ${m}분` : `${m}분`}
          </span>
        );
      },
    }),
    columnHelper.accessor("completedCount", {
      id: "completedCount",
      size: 90,
      enableSorting: true,
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            <span className="font-medium">곡 수</span>
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
      cell: ({ getValue }) => (
        <span className="font-mono tabular-nums">{getValue()}</span>
      ),
    }),
    columnHelper.accessor("albumArtPreviews", {
      id: "preview",
      size: 180,
      enableSorting: false,
      header: () => <span className="font-medium">미리보기</span>,
      cell: ({ getValue }) => {
        const arts = getValue();
        if (!arts.length) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }
        return (
          <div className="flex -space-x-2">
            {arts.slice(0, 4).map((src, i) => (
              <div
                key={`${src}-${i}`}
                className="relative w-8 h-8 rounded-md border border-background overflow-hidden"
              >
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        );
      },
    }),
    columnHelper.accessor("visibility", {
      id: "visibility",
      size: 160,
      enableSorting: true,
      header: ({ column }) => {
        const sorted = column.getIsSorted();
        return (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(sorted === "asc")}
          >
            <span className="font-medium">공개 상태</span>
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
      cell: ({ row }) => (
        <VisibilityToggle
          identifier={identifier}
          sessionId={row.original.sessionId}
          visibility={row.original.visibility}
        />
      ),
    }),
  ];
}

export function SetlistsManagement() {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";

  const { data: userPermission } = useChannelPermission(username);

  const [currentPage, setCurrentPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "startedAt", desc: true },
  ]);

  const { data, isLoading, error, refetch } = useManageSetlists(
    username,
    currentPage,
    ITEMS_PER_PAGE,
    !!username
  );

  const setlists = data?.setlists ?? [];
  const totalPages = data?.totalPages ?? 1;

  const columns = useMemo(() => buildColumns(username), [username]);

  const table = useReactTable({
    data: setlists,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    getRowId: (row) => String(row.sessionId),
  });

  const canManage =
    !userPermission || userPermission.isOwner || userPermission.manageContent;

  if (userPermission && !canManage) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="셋리스트 관리"
          description="지난 방송 셋리스트의 공개/비공개를 관리합니다."
          icon={ScrollText}
        />
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed text-muted-foreground text-center">
          접근 권한이 없습니다.
          <br />
          (채널 소유자 또는 콘텐츠 관리 권한 매니저만 접근 가능합니다)
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="셋리스트 관리"
          description="지난 방송 셋리스트의 공개/비공개를 관리합니다."
          icon={ScrollText}
        />
        <InlineError
          message="셋리스트 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="셋리스트 관리"
        description={`지난 방송 셋리스트의 공개/비공개를 관리합니다. 비공개로 전환하면 채널 셋리스트 페이지와 캘린더에서 즉시 숨겨집니다. (총 ${
          data?.total ?? 0
        }건)`}
        icon={ScrollText}
      />

      {isLoading ? (
        <div className="rounded-md border">
          <div className="h-12 bg-muted/50" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 border-t bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : setlists.length > 0 ? (
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
                    .filter(
                      (page) =>
                        page === 1 ||
                        page === totalPages ||
                        Math.abs(page - currentPage) <= 1
                    )
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
                        setCurrentPage((prev) =>
                          Math.min(totalPages, prev + 1)
                        )
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
            <ScrollText className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              아직 셋리스트가 없어요
            </h3>
            <p className="text-muted-foreground text-center">
              방송에서 신청곡이 재생 완료되면 여기에 셋리스트가 쌓입니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
