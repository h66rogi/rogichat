import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/meloming/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/meloming/shared/components/ui/form";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";
import { useForm } from "react-hook-form";
import type { CategoryEditValues } from "@/meloming/shared/constants/category";
import { DEFAULT_CATEGORY_COLORS } from "@/meloming/shared/constants/category";

type Props = {
  open: boolean;
  title?: string;
  initialValues?: Partial<CategoryEditValues>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CategoryEditValues) => Promise<void> | void;
  /** 금액 입력 필드 표시 여부 */
  showPriceField?: boolean;
  /** 재화 단위 (예: 별풍선, 치즈) */
  currencyUnit?: string;
  /** 선택 가능한 재화 목록 */
  currencyConfigs?: Array<{ key: string; unit: string }>;
  onNameFocus?: () => void;
  onNameChanged?: (value: string) => void;
  onColorTextChanged?: (value: string) => void;
  onColorPickerChanged?: (value: string) => void;
  onColorPresetSelected?: (color: string, index: number) => void;
  onDirectPriceChanged?: (value: number | null) => void;
  onCurrencyPriceChanged?: (index: number, value: number | null) => void;
  onCancelClicked?: () => void;
  onSubmitClicked?: (values: CategoryEditValues) => void;
  onValidationFailed?: (fields: string[]) => void;
};

export default function CategoryEditDialog({
  open,
  title = "카테고리 추가",
  initialValues,
  onOpenChange,
  onSubmit,
  showPriceField = false,
  currencyUnit = "",
  currencyConfigs = [],
  onNameFocus,
  onNameChanged,
  onColorTextChanged,
  onColorPickerChanged,
  onColorPresetSelected,
  onDirectPriceChanged,
  onCurrencyPriceChanged,
  onCancelClicked,
  onSubmitClicked,
  onValidationFailed,
}: Props) {
  const form = useForm<CategoryEditValues>({
    defaultValues: {
      name: initialValues?.name ?? "",
      color: initialValues?.color ?? DEFAULT_CATEGORY_COLORS[0],
      price: initialValues?.price ?? null,
      currencyPrices: initialValues?.currencyPrices ?? null,
    },
  });

  useEffect(() => {
    form.reset({
      name: initialValues?.name ?? "",
      color: initialValues?.color ?? DEFAULT_CATEGORY_COLORS[0],
      price: initialValues?.price ?? null,
      currencyPrices: initialValues?.currencyPrices ?? null,
    });
  }, [initialValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(
              async (values) => {
                const trimmedValues = {
                  name: values.name.trim(),
                  color: values.color,
                  price: values.price,
                  currencyPrices: values.currencyPrices,
                };
                onSubmitClicked?.(trimmedValues);
                await onSubmit(trimmedValues);
              },
              (errors) => onValidationFailed?.(Object.keys(errors))
            )}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: "카테고리 이름을 입력해주세요.",
                minLength: { value: 1, message: "1글자 이상" },
                maxLength: { value: 20, message: "최대 20글자" },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>카테고리 이름</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="예: 발라드, K-POP, 팝송"
                      onFocus={onNameFocus}
                      onChange={(event) => {
                        field.onChange(event);
                        onNameChanged?.(event.target.value);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              rules={{
                required: "색상을 선택해주세요.",
                pattern: {
                  value: /^#([0-9a-fA-F]{6})$/,
                  message: "예: #3B82F6",
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>색상</FormLabel>
                  <FormControl>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={field.value}
                          onChange={(e) => {
                            field.onChange(e.target.value);
                            onColorTextChanged?.(e.target.value);
                          }}
                          className="max-w-[140px]"
                          placeholder="#3B82F6"
                        />
                        <input
                          type="color"
                          aria-label="색상 선택"
                          value={field.value}
                          onChange={(e) => {
                            field.onChange(e.target.value);
                            onColorPickerChanged?.(e.target.value);
                          }}
                          className="h-9 w-9 rounded-md border bg-transparent p-0"
                        />
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {DEFAULT_CATEGORY_COLORS.map((color, index) => (
                          <button
                            key={color}
                            type="button"
                            className={`w-8 h-8 rounded-full border-2 ${
                              field.value === color
                                ? "border-foreground"
                                : "border-transparent"
                            }`}
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              field.onChange(color);
                              onColorPresetSelected?.(color, index);
                            }}
                            aria-label={`색상 ${color} 선택`}
                          />
                        ))}
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showPriceField && (
              <>
                {currencyConfigs.length > 0 ? (
                  <FormField
                    control={form.control}
                    name="currencyPrices"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>참고 가격 (선택)</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            {currencyConfigs.map((config) => {
                              const value =
                                ((field.value as Record<string, number | null> | null) ??
                                  null)?.[config.key] ?? "";
                              return (
                                <div
                                  key={config.key}
                                  className="flex items-center gap-2"
                                >
                                  <span className="text-sm min-w-24">{config.unit}</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder="미설정"
                                    value={value ?? ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const nextValue =
                                        val === "" ? null : Number(val);
                                      const next = {
                                        ...((field.value as
                                          | Record<string, number | null>
                                          | null) ?? {}),
                                        [config.key]: nextValue,
                                      };
                                      field.onChange(next);
                                      onCurrencyPriceChanged?.(
                                        currencyConfigs.findIndex(
                                          (item) => item.key === config.key
                                        ),
                                        nextValue
                                      );
                                    }}
                                    className="max-w-[160px]"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          이 카테고리에 속한 곡 신청 시 재화별로 적용할 가격
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>참고 가격 (선택)</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              placeholder="미설정"
                              value={(field.value as number | null) ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                const nextValue =
                                  val === "" ? null : Number(val);
                                field.onChange(nextValue);
                                onDirectPriceChanged?.(nextValue);
                              }}
                              className="max-w-[140px]"
                            />
                            {currencyUnit && (
                              <span className="text-sm text-muted-foreground">
                                {currencyUnit}
                              </span>
                            )}
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          이 카테고리에 속한 곡 신청 시 적용할 가격
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onCancelClicked?.();
                  onOpenChange(false);
                }}
              >
                취소
              </Button>
              <Button type="submit">저장</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
