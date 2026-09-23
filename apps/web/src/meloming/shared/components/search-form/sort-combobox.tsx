import { useState } from "react";
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
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
type SortBy = "newest" | "oldest" | "title" | "artist" | "likes_desc";

const frameworks = [
  {
    value: "newest",
    label: "최신순",
  },
  {
    value: "oldest",
    label: "오래된순",
  },
  {
    value: "title",
    label: "제목순 (가나다)",
  },
  {
    value: "artist",
    label: "가수순 (가나다)",
  },
  {
    value: "likes_desc",
    label: "좋아요 많은 순",
  },
];

interface SortComboboxProps {
  value: SortBy;
  onValueChange: (value: SortBy) => void;
}

export default function SortCombobox({
  value,
  onValueChange,
}: SortComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value
            ? frameworks.find((framework) => framework.value === value)?.label
            : "정렬 기준"}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput
            placeholder="정렬 기준을 선택해주세요."
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>정렬 기준을 선택해주세요.</CommandEmpty>
            <CommandGroup>
              {frameworks.map((framework) => (
                <CommandItem
                  key={framework.value}
                  value={framework.value}
                  onSelect={(currentValue) => {
                    onValueChange(currentValue as SortBy);
                    setOpen(false);
                  }}
                >
                  {framework.label}
                  <Check
                    className={cn(
                      "ml-auto",
                      value === framework.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
