import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent, CardTitle } from "@/meloming/shared/components/ui/card";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Music, User, Tag, Loader2, AlertTriangle, Info } from "lucide-react";
import type { SongFormValues } from "./song-form.schema";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import {
  formatValidationIssue,
  type ExcelValidationIssue,
} from "./add-song-excel-utils";

export function AddSongExcelPreview({
  processedData,
  onAutoMap,
  onRegister,
  isMapping,
  isRegistering,
  canRegister,
  validationIssues,
  skippedDuplicateCount,
  DefaultImage,
}: {
  processedData: SongFormValues[];
  onAutoMap: () => void | Promise<void>;
  onRegister: () => void | Promise<void>;
  isMapping: boolean;
  isRegistering: boolean;
  canRegister: boolean;
  validationIssues: ExcelValidationIssue[];
  skippedDuplicateCount: number;
  DefaultImage: () => React.ReactNode;
}) {
  return (
    <div
      id="excel-result"
      className="flex flex-col gap-4 flex-1 p-4 rounded-lg min-w-96"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAutoMap}
              disabled={isMapping || processedData.length === 0}
            >
              {isMapping ? (
                <>
                  <Loader2 className="animate-spin" /> 검색 및 매핑 중...
                </>
              ) : (
                "앨범아트 자동 검색"
              )}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onRegister}
              disabled={!canRegister || isRegistering}
            >
              {isRegistering ? (
                <>
                  <Loader2 className="animate-spin" /> 등록 중...
                </>
              ) : (
                "등록하기"
              )}
            </Button>
          </div>
        </div>
        {validationIssues.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                {validationIssues.slice(0, 5).map((issue, index) => (
                  <li key={`${issue.rowNumber ?? "all"}-${issue.field}-${index}`}>
                    {formatValidationIssue(issue)}
                  </li>
                ))}
              </ul>
              {validationIssues.length > 5 && (
                <p className="text-xs">
                  외 {validationIssues.length - 5}개 항목이 더 있습니다.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
        {skippedDuplicateCount > 0 && validationIssues.length === 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              중복 {skippedDuplicateCount}곡은 등록하지 않고 건너뜁니다.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="space-y-3 overflow-y-auto">
        {processedData.length === 0 ? (
          <div className="p-8 border-2 border-dashed border-gray-300 rounded-lg text-center">
            <p className="text-muted-foreground">
              노래 제목을 입력하면 여기에 미리보기가 표시됩니다.
            </p>
          </div>
        ) : (
          processedData.map((item, index) => (
            <Card key={index} className="w-full py-2 px-2">
              <CardContent className="flex items-center gap-4 px-0">
                <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                  {item.albumArt ? (
                    <img
                      src={item.albumArt}
                      alt="노래 이미지"
                      className="w-16 h-16 object-cover"
                    />
                  ) : (
                    <DefaultImage />
                  )}
                </div>

                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <CardTitle className="flex items-center gap-2 text-xl paperlogy">
                    <Music className="h-4 w-4" />
                    {item.title || "제목 없음"}
                  </CardTitle>
                  <div className="flex flex-row flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{item.artistName || "아티스트 미입력"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Tag className="h-3 w-3" />
                      <div className="flex gap-1 flex-wrap">
                        {(item.categoryNames ?? []).length ? (
                          item.categoryNames.slice(0, 3).map((c) => (
                            <Badge key={c} variant="secondary">
                              {c}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">
                            카테고리 미입력
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>난이도 {item.difficulty ?? 1}</span>
                      {typeof item.proficiency === "number" && (
                        <>
                          <span>·</span>
                          <span>숙련도 {item.proficiency}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
