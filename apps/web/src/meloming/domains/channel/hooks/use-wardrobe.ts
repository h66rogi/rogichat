import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWardrobeCategory,
  createWardrobeItem,
  deleteWardrobeCategory,
  deleteWardrobeItem,
  getChannelWardrobe,
  getChannelWardrobeManage,
  updateWardrobeCategory,
  updateWardrobeItem,
} from "@/meloming/domains/channel/apis/wardrobe";
import type {
  CreateWardrobeCategoryInput,
  CreateWardrobeItemInput,
  UpdateWardrobeCategoryInput,
  UpdateWardrobeItemInput,
} from "@/meloming/domains/channel/types/wardrobe";

export const wardrobeKeys = {
  all: ["channel-wardrobe"] as const,
  public: (identifier: string) =>
    [...wardrobeKeys.all, "public", identifier] as const,
  manage: (identifier: string) =>
    [...wardrobeKeys.all, "manage", identifier] as const,
};

export function useChannelWardrobe(identifier: string) {
  return useQuery({
    queryKey: wardrobeKeys.public(identifier),
    queryFn: () => getChannelWardrobe(identifier),
    enabled: !!identifier,
    staleTime: 5 * 60 * 1000,
  });
}

export function useChannelWardrobeManage(identifier: string) {
  return useQuery({
    queryKey: wardrobeKeys.manage(identifier),
    queryFn: () => getChannelWardrobeManage(identifier),
    enabled: !!identifier,
    staleTime: 30 * 1000,
  });
}

function useWardrobeInvalidation(identifier: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: wardrobeKeys.public(identifier) });
    queryClient.invalidateQueries({ queryKey: wardrobeKeys.manage(identifier) });
  };
}

export function useCreateWardrobeCategory(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: (input: CreateWardrobeCategoryInput) =>
      createWardrobeCategory(identifier, input),
    onSuccess: invalidate,
  });
}

export function useUpdateWardrobeCategory(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: ({
      categoryId,
      input,
    }: {
      categoryId: number;
      input: UpdateWardrobeCategoryInput;
    }) => updateWardrobeCategory(identifier, categoryId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteWardrobeCategory(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: (categoryId: number) =>
      deleteWardrobeCategory(identifier, categoryId),
    onSuccess: invalidate,
  });
}

export function useCreateWardrobeItem(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: (input: CreateWardrobeItemInput) =>
      createWardrobeItem(identifier, input),
    onSuccess: invalidate,
  });
}

export function useUpdateWardrobeItem(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: ({
      itemId,
      input,
    }: {
      itemId: number;
      input: UpdateWardrobeItemInput;
    }) => updateWardrobeItem(identifier, itemId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteWardrobeItem(identifier: string) {
  const invalidate = useWardrobeInvalidation(identifier);
  return useMutation({
    mutationFn: (itemId: number) => deleteWardrobeItem(identifier, itemId),
    onSuccess: invalidate,
  });
}
