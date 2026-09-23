import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { Calendar } from "@/meloming/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Toggle } from "@/meloming/shared/components/ui/toggle";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  usePatchChannelProfile,
  type ChannelProfile,
  type PatchChannelProfileRequestBody,
} from "@/meloming/domains/channel-profile";
import { toast } from "sonner";
import { cn } from "@/meloming/shared/lib/utils";

// ENUM 정의
const GENDER_OPTIONS = {
  MALE: "남성",
  FEMALE: "여성",
  NONBINARY: "논바이너리",
  OTHER: "기타",
  SECRET: "비공개",
} as const;

const MBTI_OPTIONS = [
  "ISTJ",
  "ISFJ",
  "INFJ",
  "INTJ",
  "ISTP",
  "ISFP",
  "INFP",
  "INTP",
  "ESTP",
  "ESFP",
  "ENFP",
  "ENTP",
  "ESTJ",
  "ESFJ",
  "ENFJ",
  "ENTJ",
] as const;

const PLATFORM_OPTIONS = {
  SOOP: "SOOP",
  CHZZK: "CHZZK",
  CIME: "CIME",
  YOUTUBE: "YouTube",
  OTHER: "기타",
} as const;

interface ChannelInfoEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: number;
  profile?: ChannelProfile | null;
}

type FieldKey = keyof PatchChannelProfileRequestBody;

interface FieldConfig {
  key: FieldKey;
  label: string;
  type:
    | "text"
    | "date"
    | "number"
    | "textarea"
    | "array"
    | "select"
    | "color"
    | "toggle"
    | "toggle-multi";
  placeholder?: string;
  maxLength?: number;
  options?: readonly string[] | Record<string, string>;
}

const FIELD_CONFIGS: FieldConfig[] = [
  { key: "nickname", label: "닉네임", type: "text", placeholder: "닉네임" },
  { key: "birthday", label: "생일", type: "date" },
  { key: "residence", label: "거주지", type: "text", placeholder: "거주지" },
  { key: "nationality", label: "국적", type: "text", placeholder: "국적" },
  {
    key: "gender",
    label: "성별",
    type: "toggle",
    placeholder: "성별 선택",
    options: GENDER_OPTIONS,
  },
  { key: "heightCm", label: "키", type: "text", placeholder: "키" },
  {
    key: "weightKg",
    label: "몸무게",
    type: "text",
    placeholder: "몸무게",
  },
  {
    key: "mbti",
    label: "MBTI",
    type: "select",
    placeholder: "MBTI 선택",
    options: MBTI_OPTIONS,
  },
  {
    key: "symbolColor",
    label: "상징 색상",
    type: "color",
    placeholder: "#000000",
  },
  { key: "agency", label: "소속사", type: "text", placeholder: "소속사" },
  { key: "fandomName", label: "팬덤명", type: "text", placeholder: "팬덤명" },
  { key: "religion", label: "종교", type: "text", placeholder: "종교" },
  { key: "debutDate", label: "데뷔일", type: "date" },
  {
    key: "alias",
    label: "별명",
    type: "array",
    placeholder: "별명1, 별명2, ...",
  },
  {
    key: "affiliatedGroups",
    label: "소속 그룹",
    type: "array",
    placeholder: "그룹1, 그룹2, ...",
  },
  {
    key: "broadcastingPlatforms",
    label: "방송 플랫폼",
    type: "toggle-multi",
    placeholder: "플랫폼 선택",
    options: PLATFORM_OPTIONS,
  },
  {
    key: "education",
    label: "학력",
    type: "array",
    placeholder: "학교1, 학교2, ...",
  },
  {
    key: "bio",
    label: "약력",
    type: "textarea",
    placeholder: "약력을 입력하세요",
  },
];

export function ChannelInfoEditModal({
  open,
  onOpenChange,
  channelId,
  profile,
}: ChannelInfoEditModalProps) {
  const { mutate: patchProfile, isPending } = usePatchChannelProfile(channelId);

  // Form state
  const [formData, setFormData] = useState<PatchChannelProfileRequestBody>({
    birthday: profile?.birthday || null,
    residence: profile?.residence || null,
    heightCm: profile?.heightCm || null,
    weightKg: profile?.weightKg || null,
    nationality: profile?.nationality || null,
    gender: profile?.gender || null,
    symbolColor: profile?.symbolColor || null,
    agency: profile?.agency || null,
    nickname: profile?.nickname || null,
    affiliatedGroups: profile?.affiliatedGroups || [],
    fandomName: profile?.fandomName || null,
    religion: profile?.religion || null,
    education: profile?.education || [],
    mbti: profile?.mbti || null,
    alias: profile?.alias || [],
    debutDate: profile?.debutDate || null,
    broadcastingPlatforms: profile?.broadcastingPlatforms || [],
    bio: profile?.bio || null,
    links: profile?.links || [],
  });

  // Switch states - 각 필드의 활성화 여부
  const [fieldEnabled, setFieldEnabled] = useState<Record<FieldKey, boolean>>({
    nickname: false,
    birthday: false,
    residence: false,
    nationality: false,
    gender: false,
    heightCm: false,
    weightKg: false,
    mbti: false,
    symbolColor: false,
    agency: false,
    fandomName: false,
    religion: false,
    debutDate: false,
    alias: false,
    affiliatedGroups: false,
    broadcastingPlatforms: false,
    education: false,
    bio: false,
    description: false,
    homeDescription: false,
    links: false,
  });

  // 생일 날짜만 선택 모드 (연도 제외)
  const [birthdayDateOnly, setBirthdayDateOnly] = useState(false);

  useEffect(() => {
    if (profile) {
      // 프로필 데이터로 폼 초기화
      setFormData({
        birthday: profile.birthday || null,
        residence: profile.residence || null,
        heightCm: profile.heightCm || null,
        weightKg: profile.weightKg || null,
        nationality: profile.nationality || null,
        gender: profile.gender || null,
        symbolColor: profile.symbolColor || null,
        agency: profile.agency || null,
        nickname: profile.nickname || null,
        affiliatedGroups: profile.affiliatedGroups || [],
        fandomName: profile.fandomName || null,
        religion: profile.religion || null,
        education: profile.education || [],
        mbti: profile.mbti || null,
        alias: profile.alias || [],
        debutDate: profile.debutDate || null,
        broadcastingPlatforms: profile.broadcastingPlatforms || [],
        bio: profile.bio || null,
        links: profile.links || [],
      });

      // 값이 있는 필드의 Switch를 켬
      setFieldEnabled({
        nickname: !!profile.nickname,
        birthday: !!profile.birthday,
        residence: !!profile.residence,
        nationality: !!profile.nationality,
        gender: !!profile.gender,
        heightCm: !!profile.heightCm,
        weightKg: !!profile.weightKg,
        mbti: !!profile.mbti,
        symbolColor: !!profile.symbolColor,
        agency: !!profile.agency,
        fandomName: !!profile.fandomName,
        religion: !!profile.religion,
        debutDate: !!profile.debutDate,
        alias: !!(profile.alias && profile.alias.length > 0),
        affiliatedGroups: !!(
          profile.affiliatedGroups && profile.affiliatedGroups.length > 0
        ),
        broadcastingPlatforms: !!(
          profile.broadcastingPlatforms &&
          profile.broadcastingPlatforms.length > 0
        ),
        education: !!(profile.education && profile.education.length > 0),
        bio: !!profile.bio,
        description: false,
        homeDescription: false,
        links: false,
      });

      // 생일이 1900년인 경우 날짜만 선택 모드로 설정
      if (profile.birthday) {
        const birthdayDate = new Date(profile.birthday);
        setBirthdayDateOnly(birthdayDate.getFullYear() === 1900);
      }
    }
  }, [profile]);

  const handleSubmit = () => {
    // Switch가 꺼진 필드는 null 또는 빈 배열로 설정
    const dataToSubmit: PatchChannelProfileRequestBody = {
      nickname: fieldEnabled.nickname ? formData.nickname : null,
      birthday: fieldEnabled.birthday ? formData.birthday : null,
      residence: fieldEnabled.residence ? formData.residence : null,
      nationality: fieldEnabled.nationality ? formData.nationality : null,
      gender: fieldEnabled.gender ? formData.gender : null,
      heightCm: fieldEnabled.heightCm ? formData.heightCm : null,
      weightKg: fieldEnabled.weightKg ? formData.weightKg : null,
      mbti: fieldEnabled.mbti ? formData.mbti : null,
      symbolColor: fieldEnabled.symbolColor ? formData.symbolColor : null,
      agency: fieldEnabled.agency ? formData.agency : null,
      fandomName: fieldEnabled.fandomName ? formData.fandomName : null,
      religion: fieldEnabled.religion ? formData.religion : null,
      debutDate: fieldEnabled.debutDate ? formData.debutDate : null,
      alias: fieldEnabled.alias ? formData.alias : [],
      affiliatedGroups: fieldEnabled.affiliatedGroups
        ? formData.affiliatedGroups
        : [],
      broadcastingPlatforms: fieldEnabled.broadcastingPlatforms
        ? formData.broadcastingPlatforms
        : [],
      education: fieldEnabled.education ? formData.education : [],
      bio: fieldEnabled.bio ? formData.bio : null,
      links: formData.links,
    };

    patchProfile(dataToSubmit, {
      onSuccess: () => {
        toast.success("채널 정보가 저장되었습니다.");
        onOpenChange(false);
      },
      onError: () => {
        toast.error("채널 정보 저장에 실패했습니다.");
      },
    });
  };

  const handleArrayInput = (value: string): string[] => {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const toggleField = (key: FieldKey) => {
    setFieldEnabled((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleFieldChange = (key: FieldKey, value: string | number | null) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const getFieldValue = (field: FieldConfig): string => {
    const value = formData[field.key];
    if (field.type === "array" && Array.isArray(value)) {
      return value.join(", ");
    }
    return value?.toString() || "";
  };

  const getDateValue = (dateString: string | null): Date | undefined => {
    if (!dateString) return undefined;
    return new Date(dateString);
  };

  const formatDateToString = (date: Date | undefined): string | null => {
    if (!date) return null;
    return format(date, "yyyy-MM-dd");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>채널 프로필 편집</DialogTitle>
          <DialogDescription>
            각 항목을 활성화하고 정보를 입력하세요. (여러 항목은 쉼표로 구분)
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="w-full">
                {FIELD_CONFIGS.map((field, index) => {
                  const isEnabled = fieldEnabled[field.key];
                  const isLastRow = index === FIELD_CONFIGS.length - 1;

                  return (
                    <div
                      key={field.key}
                      className={cn(
                        "grid grid-cols-[4rem_8rem_1fr]",
                        !isLastRow &&
                          "border-b border-gray-200 dark:border-gray-700"
                      )}
                    >
                      {/* Switch 컬럼 */}
                      <div className="px-4 py-3 text-center bg-gray-50 dark:bg-gray-900/50">
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                      </div>

                      {/* Label 컬럼 */}
                      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50">
                        <Label
                          htmlFor={field.key}
                          className={
                            !isEnabled ? "text-gray-400 dark:text-gray-600" : ""
                          }
                        >
                          {field.label}
                        </Label>
                      </div>

                      {/* Input 컬럼 */}
                      <div className="px-4 py-3">
                        {field.type === "toggle" ? (
                          <div className="flex flex-wrap gap-2">
                            {field.options &&
                              Object.entries(field.options).map(
                                ([key, label]) => {
                                  const isPressed = formData[field.key] === key;
                                  return (
                                    <Toggle
                                      key={key}
                                      pressed={isPressed}
                                      onPressedChange={(pressed) => {
                                        handleFieldChange(
                                          field.key,
                                          pressed ? key : null
                                        );
                                      }}
                                      disabled={!isEnabled}
                                      variant="outline"
                                      size="sm"
                                      className={cn(
                                        "min-w-[80px]",
                                        !isEnabled &&
                                          "opacity-50 cursor-not-allowed"
                                      )}
                                    >
                                      {label}
                                    </Toggle>
                                  );
                                }
                              )}
                          </div>
                        ) : field.type === "toggle-multi" ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {field.options &&
                                Object.entries(field.options).map(
                                  ([key, label]) => {
                                    const platforms = (formData[field.key] ||
                                      []) as string[];
                                    const isPressed = platforms.includes(key);
                                    return (
                                      <Toggle
                                        key={key}
                                        pressed={isPressed}
                                        onPressedChange={(pressed) => {
                                          const current = [...platforms];
                                          if (pressed) {
                                            if (!current.includes(key)) {
                                              current.push(key);
                                            }
                                          } else {
                                            const index = current.indexOf(key);
                                            if (index > -1) {
                                              current.splice(index, 1);
                                            }
                                          }
                                          handleFieldChange(
                                            field.key,
                                            current as never
                                          );
                                        }}
                                        disabled={!isEnabled}
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          "min-w-[80px]",
                                          !isEnabled &&
                                            "opacity-50 cursor-not-allowed"
                                        )}
                                      >
                                        {label}
                                      </Toggle>
                                    );
                                  }
                                )}
                            </div>
                            {((formData[field.key] || []) as string[]).includes(
                              "OTHER"
                            ) && (
                              <Input
                                placeholder="기타 플랫폼을 입력하세요 (쉼표로 구분)"
                                value={
                                  ((formData[field.key] || []) as string[])
                                    .filter(
                                      (p) =>
                                        field.options &&
                                        !Object.keys(field.options).includes(p)
                                    )
                                    .join(", ") || ""
                                }
                                onChange={(e) => {
                                  const standardPlatforms = (
                                    (formData[field.key] || []) as string[]
                                  ).filter(
                                    (p) =>
                                      field.options &&
                                      Object.keys(field.options).includes(p)
                                  );
                                  const customPlatforms = handleArrayInput(
                                    e.target.value
                                  );
                                  handleFieldChange(field.key, [
                                    ...standardPlatforms,
                                    ...customPlatforms,
                                  ] as never);
                                }}
                                disabled={!isEnabled}
                                className={
                                  !isEnabled
                                    ? "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                                    : ""
                                }
                              />
                            )}
                          </div>
                        ) : field.type === "select" ? (
                          <Select
                            value={
                              (formData[field.key] as string | null) ||
                              undefined
                            }
                            onValueChange={(value) => {
                              handleFieldChange(
                                field.key,
                                value === "__NONE__" ? null : value
                              );
                            }}
                            disabled={!isEnabled}
                          >
                            <SelectTrigger
                              className={cn(
                                "w-full",
                                !isEnabled &&
                                  "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                              )}
                            >
                              <SelectValue placeholder={field.placeholder} />
                            </SelectTrigger>
                            <SelectContent>
                              {field.key === "mbti" && (
                                <SelectItem value="__NONE__">선택</SelectItem>
                              )}
                              {field.options &&
                                (Array.isArray(field.options)
                                  ? field.options.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {option}
                                      </SelectItem>
                                    ))
                                  : Object.entries(field.options).map(
                                      ([key, label]) => (
                                        <SelectItem key={key} value={key}>
                                          {label}
                                        </SelectItem>
                                      )
                                    ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "color" ? (
                          <div className="flex gap-2 items-center">
                            <Input
                              id={field.key}
                              type="color"
                              value={
                                (formData[field.key] as string) || "#000000"
                              }
                              onChange={(e) => {
                                handleFieldChange(field.key, e.target.value);
                              }}
                              disabled={!isEnabled}
                              className={cn(
                                "w-20 h-10 p-1 cursor-pointer",
                                !isEnabled && "cursor-not-allowed opacity-50"
                              )}
                            />
                            <Input
                              type="text"
                              value={(formData[field.key] as string) || ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (
                                  /^#[0-9A-F]{6}$/i.test(value) ||
                                  value === ""
                                ) {
                                  handleFieldChange(field.key, value || null);
                                }
                              }}
                              placeholder={field.placeholder}
                              disabled={!isEnabled}
                              className={cn(
                                "flex-1 font-mono",
                                !isEnabled &&
                                  "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                              )}
                              maxLength={7}
                            />
                          </div>
                        ) : field.type === "textarea" ? (
                          <Textarea
                            id={field.key}
                            value={getFieldValue(field)}
                            onChange={(e) => {
                              handleFieldChange(
                                field.key,
                                e.target.value || null
                              );
                            }}
                            placeholder={field.placeholder}
                            rows={3}
                            disabled={!isEnabled}
                            className={
                              !isEnabled
                                ? "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                                : ""
                            }
                          />
                        ) : field.type === "date" ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "flex-1 justify-start text-left font-normal",
                                      !getDateValue(
                                        formData[field.key] as string | null
                                      ) && "text-muted-foreground",
                                      !isEnabled &&
                                        "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                                    )}
                                    disabled={!isEnabled}
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {getDateValue(
                                      formData[field.key] as string | null
                                    ) ? (
                                      format(
                                        getDateValue(
                                          formData[field.key] as string | null
                                        )!,
                                        field.key === "birthday" &&
                                          birthdayDateOnly
                                          ? "MM/dd"
                                          : "yyyy/MM/dd",
                                        { locale: ko }
                                      )
                                    ) : (
                                      <span>
                                        {field.placeholder || "날짜 선택"}
                                      </span>
                                    )}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-auto p-0"
                                  align="start"
                                >
                                  <Calendar
                                    mode="single"
                                    selected={
                                      field.key === "birthday" &&
                                      birthdayDateOnly
                                        ? (() => {
                                            const dateValue = getDateValue(
                                              formData[field.key] as
                                                | string
                                                | null
                                            );
                                            if (dateValue) {
                                              // 1900년 날짜를 현재 연도로 변환하여 표시
                                              const displayDate = new Date(
                                                dateValue
                                              );
                                              displayDate.setFullYear(
                                                new Date().getFullYear()
                                              );
                                              return displayDate;
                                            }
                                            return undefined;
                                          })()
                                        : getDateValue(
                                            formData[field.key] as string | null
                                          )
                                    }
                                    onSelect={(date) => {
                                      if (
                                        field.key === "birthday" &&
                                        birthdayDateOnly &&
                                        date
                                      ) {
                                        // 날짜만 선택 모드일 때 연도를 1900으로 고정하여 저장
                                        const fixedDate = new Date(date);
                                        fixedDate.setFullYear(1900);
                                        handleFieldChange(
                                          field.key,
                                          formatDateToString(fixedDate)
                                        );
                                      } else {
                                        handleFieldChange(
                                          field.key,
                                          formatDateToString(date)
                                        );
                                      }
                                    }}
                                    captionLayout={
                                      field.key === "birthday" &&
                                      birthdayDateOnly
                                        ? "label"
                                        : "dropdown"
                                    }
                                    fromYear={1950}
                                    toYear={new Date().getFullYear()}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                              {field.key === "birthday" && (
                                <Toggle
                                  pressed={birthdayDateOnly}
                                  onPressedChange={(pressed) => {
                                    setBirthdayDateOnly(pressed);
                                    // 날짜만 선택 모드로 전환 시, 기존 날짜가 있으면 연도를 1900으로 변경
                                    if (pressed && formData.birthday) {
                                      const date = new Date(formData.birthday);
                                      date.setFullYear(1900);
                                      handleFieldChange(
                                        "birthday",
                                        formatDateToString(date)
                                      );
                                    }
                                  }}
                                  disabled={!isEnabled}
                                  variant="outline"
                                  // size="sm"
                                  className={cn(
                                    "text-xs whitespace-nowrap",
                                    !isEnabled &&
                                      "opacity-50 cursor-not-allowed"
                                  )}
                                >
                                  날짜만 선택
                                </Toggle>
                              )}
                            </div>
                            {field.key === "birthday" && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                나이를 공개하지 않았다면 날짜만 선택해주세요
                              </p>
                            )}
                          </div>
                        ) : field.type === "array" ? (
                          <Input
                            id={field.key}
                            value={getFieldValue(field)}
                            onChange={(e) => {
                              const arrayValue = handleArrayInput(
                                e.target.value
                              );
                              handleFieldChange(field.key, arrayValue as never);
                            }}
                            placeholder={field.placeholder}
                            disabled={!isEnabled}
                            className={
                              !isEnabled
                                ? "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                                : ""
                            }
                          />
                        ) : (
                          <Input
                            id={field.key}
                            type="text"
                            value={getFieldValue(field)}
                            onChange={(e) => {
                              handleFieldChange(
                                field.key,
                                e.target.value || null
                              );
                            }}
                            placeholder={field.placeholder}
                            maxLength={field.maxLength}
                            disabled={!isEnabled}
                            className={
                              !isEnabled
                                ? "bg-gray-100 dark:bg-gray-900 cursor-not-allowed"
                                : ""
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
