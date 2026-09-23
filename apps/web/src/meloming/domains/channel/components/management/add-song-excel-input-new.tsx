import { Workbook } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import {
  useRef,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import type { WorkbookInstance } from "@fortune-sheet/react";
import {
  getSheetRowKeyByColumnIndex,
  isMeaningfulSheetRow,
  parseFortuneSheetRows,
  type SheetRow,
} from "./add-song-excel-utils";

export interface AddSongExcelInputHandle {
  loadData: (rows: SheetRow[]) => void;
  clearData: () => void;
}

export const AddSongExcelInput = forwardRef<
  AddSongExcelInputHandle,
  {
    onChange: (data: SheetRow[]) => void;
    columnLabels: readonly string[];
  }
>(({ onChange, columnLabels }, ref) => {
  const workbookRef = useRef<WorkbookInstance>(null);
  const lastDataRef = useRef<string>("");

  // Map column index to our SheetRow key based on provided labels
  const columnIndexToKey = useCallback(
    (colIdx: number) => getSheetRowKeyByColumnIndex(columnLabels, colIdx),
    [columnLabels]
  );

  const createWorkbookData = useCallback(
    (rows: SheetRow[]) => {
      const celldata = columnLabels.map((label, colIdx) => ({
        r: 0,
        c: colIdx,
        v: {
          m: label,
          v: label,
          ct: { fa: "General", t: "g" },
        },
      }));

      rows.forEach((row, rowIdx) => {
        columnLabels.forEach((_, colIdx) => {
          const key = columnIndexToKey(colIdx);
          if (!key) return;
          const val = row[key] ?? "";
          celldata.push({
            r: rowIdx + 1,
            c: colIdx,
            v: {
              m: String(val),
              v: String(val),
              ct: { fa: "General", t: "g" },
            },
          });
        });
      });

      return [
        {
          name: "곡 목록",
          id: "song-list",
          status: 1,
          order: 0,
          celldata,
          row: Math.max(100, rows.length + 1),
          column: Math.max(26, columnLabels.length),
          config: {
            columnlen: {
              "0": 250,
              "1": 180,
              "2": 220,
            },
            rowlen: {
              "0": 30,
            },
          },
          frozen: {
            type: "row" as const,
          },
        },
      ];
    },
    [columnIndexToKey, columnLabels]
  );

  const initialData = useMemo(
    () => createWorkbookData([]),
    [createWorkbookData]
  );

  // Expose methods to parent
  useImperativeHandle(
    ref,
    () => ({
      loadData: (rows: SheetRow[]) => {
        try {
          lastDataRef.current = JSON.stringify(
            rows.filter(isMeaningfulSheetRow)
          );
          workbookRef.current?.updateSheet(createWorkbookData(rows));
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.error("[AddSongExcelInput] loadData error:", error);
          }
        }
      },
      clearData: () => {
        try {
          lastDataRef.current = "[]";
          workbookRef.current?.updateSheet(createWorkbookData([]));
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.error("[AddSongExcelInput] clearData error:", error);
          }
        }
      },
    }),
    [createWorkbookData]
  );

  // FortuneSheet의 데이터를 실시간으로 변환
  const handleSheetChange = useCallback(
    (sheetDataArray: unknown[]) => {
      try {
        if (process.env.NODE_ENV === "development") {
          console.log("[AddSongExcelInput] onChange payload:", sheetDataArray);
        }

        const result = parseFortuneSheetRows(sheetDataArray, columnLabels);
        if (result.length === 0 && process.env.NODE_ENV === "development") {
          console.warn(
            "[AddSongExcelInput] Parsed no meaningful rows from sheet payload"
          );
        }

        // 데이터가 실제로 변경되었을 때만 onChange 호출
        const resultStr = JSON.stringify(result);
        if (resultStr !== lastDataRef.current) {
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[AddSongExcelInput] parsed rows (count):",
              result.length,
              result.slice(0, 5)
            );
          }
          lastDataRef.current = resultStr;
          onChange(result);
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("[AddSongExcelInput] data conversion error:", error);
        }
      }
    },
    [onChange, columnLabels]
  );

  return (
    <div
      className="w-full h-[calc(100vh-300px)] min-h-[500px] border rounded-lg overflow-hidden bg-white dark:bg-gray-950"
      style={{
        msOverflowStyle: "none",
        scrollbarWidth: "none",
      }}
    >
      <Workbook
        ref={workbookRef}
        data={initialData}
        onChange={handleSheetChange}
        lang="en"
        showToolbar={true}
        showFormulaBar={true}
        showSheetTabs={false}
        toolbarItems={[
          "undo",
          "redo",
          "format-painter",
          "clear-format",
          "|",
          "number-decrease",
          "number-increase",
          "format",
          "|",
          "merge-cell",
          "quick-formula",
        ]}
        columnHeaderHeight={30}
        rowHeaderWidth={50}
      />
    </div>
  );
});

AddSongExcelInput.displayName = "AddSongExcelInput";
