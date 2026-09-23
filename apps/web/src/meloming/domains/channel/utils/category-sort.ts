import type { Category } from "@/meloming/domains/channel/types/category";

/**
 * 카테고리를 정렬합니다.
 * - displayOrder가 높은 순서대로 정렬
 * - displayOrder가 같거나 없는 경우 name 가나다순으로 정렬
 * - displayOrder가 없는 카테고리는 뒤쪽에 배치
 *
 * @param categories - 정렬할 카테고리 배열
 * @returns 정렬된 카테고리 배열
 */
export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => {
    const orderA = a.displayOrder ?? -Infinity;
    const orderB = b.displayOrder ?? -Infinity;

    // displayOrder가 다르면 높은 순으로 정렬
    if (orderA !== orderB) {
      return orderB - orderA;
    }

    // displayOrder가 같으면 name 가나다순으로 정렬
    return a.name.localeCompare(b.name, "ko");
  });
}

export function hasInvalidCategoryDisplayOrder(categories: Category[]): boolean {
  const seenOrders = new Set<number>();

  for (const category of categories) {
    if (category.displayOrder == null) {
      return true;
    }

    if (seenOrders.has(category.displayOrder)) {
      return true;
    }

    seenOrders.add(category.displayOrder);
  }

  return false;
}

export function normalizeCategoryDisplayOrder(categories: Category[]): Category[] {
  const sortedCategories = sortCategories(categories);

  return sortedCategories.map((category, index) => ({
    ...category,
    displayOrder: (sortedCategories.length - index) * 10,
  }));
}

export function swapCategoryDisplayOrder(
  categories: Category[],
  firstCategoryId: number,
  secondCategoryId: number
): Category[] {
  const baseCategories = hasInvalidCategoryDisplayOrder(categories)
    ? normalizeCategoryDisplayOrder(categories)
    : categories.map((category) => ({ ...category }));

  const firstCategory = baseCategories.find(
    (category) => category.id === firstCategoryId
  );
  const secondCategory = baseCategories.find(
    (category) => category.id === secondCategoryId
  );

  if (!firstCategory || !secondCategory) {
    return baseCategories;
  }

  const firstOrder = firstCategory.displayOrder;
  const secondOrder = secondCategory.displayOrder;

  firstCategory.displayOrder = secondOrder;
  secondCategory.displayOrder = firstOrder;

  return baseCategories;
}
