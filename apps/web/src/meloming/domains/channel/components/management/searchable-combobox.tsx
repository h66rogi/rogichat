import { useMemo, useState } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/meloming/shared/components/ui/command";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";

interface SearchableComboboxProps {
  value: string;
  onValueChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  emptyCreatePrefix?: string; // e.g., "추가"
  buttonClassName?: string;
  onCreate?: (name: string) => Promise<string | void> | string | void;
}

export default function SearchableCombobox({
  value,
  onValueChange,
  options,
  placeholder = "검색...",
  emptyCreatePrefix = "추가",
  buttonClassName,
  onCreate,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const normalizedOptions = useMemo(
    () => Array.from(new Set(options.filter(Boolean))).sort(),
    [options]
  );

  const hasExact = useMemo(
    () =>
      query.trim().length > 0 &&
      normalizedOptions.some(
        (opt) => opt.toLowerCase() === query.trim().toLowerCase()
      ),
    [normalizedOptions, query]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", buttonClassName)}
        >
          {value || placeholder}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0">
        <Command>
          <CommandInput
            placeholder={placeholder}
            className="h-9"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim().length > 0 ? (
                <div className="flex items-center justify-between px-2 py-2">
                  <span className="text-sm text-muted-foreground">
                    결과가 없습니다.
                  </span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  검색어를 입력하세요.
                </span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {normalizedOptions.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={(currentValue) => {
                    onValueChange(currentValue);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {opt}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === opt ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
              {!hasExact && query.trim().length > 0 && (
                <CommandItem
                  value={`__create__${query}`}
                  disabled={creating}
                  onSelect={async () => {
                    const name = query.trim();
                    if (!name) return;
                    if (!onCreate) {
                      onValueChange(name);
                      setOpen(false);
                      setQuery("");
                      return;
                    }
                    try {
                      setCreating(true);
                      const created = await onCreate(name);
                      onValueChange((created as string) || name);
                      setOpen(false);
                      setQuery("");
                    } catch (_err) {
                      // noop: 부모에서 에러 토스트/처리를 담당하도록 둠
                    } finally {
                      setCreating(false);
                    }
                  }}
                >
                  <Plus className="mr-2" /> {emptyCreatePrefix}: "{query.trim()}
                  "
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
