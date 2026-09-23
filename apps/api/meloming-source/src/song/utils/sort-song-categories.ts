/**
 * 곡에 포함된 카테고리를 displayOrder 기준으로 정렬합니다.
 * - displayOrder가 높은 순서대로 (관리페이지 설정 순서)
 * - displayOrder가 같거나 없으면 이름 가나다순
 * - displayOrder가 null인 카테고리는 뒤쪽에 배치
 */
export function sortSongCategories(
  songCategories?: {
    category: {
      displayOrder?: number | null;
      name: string;
      [key: string]: any;
    };
  }[],
) {
  if (!songCategories) return [];
  return songCategories
    .map((sc) => sc.category)
    .sort((a, b) => {
      const orderA = a.displayOrder ?? -Infinity;
      const orderB = b.displayOrder ?? -Infinity;
      if (orderA !== orderB) return orderB - orderA;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
}
