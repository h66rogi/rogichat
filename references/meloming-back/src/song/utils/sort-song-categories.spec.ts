import { sortSongCategories } from './sort-song-categories';

function sc(name: string, displayOrder?: number | null) {
  return {
    category: {
      id: Math.random(),
      name,
      displayOrder: displayOrder ?? null,
      color: '#000',
    },
  };
}

describe('sortSongCategories', () => {
  it('displayOrder가 높은 순서대로 정렬한다', () => {
    const input = [sc('C', 10), sc('A', 30), sc('B', 20)];
    const result = sortSongCategories(input);
    expect(result.map((c) => c.name)).toEqual(['A', 'B', 'C']);
  });

  it('displayOrder가 같으면 이름 가나다순으로 정렬한다', () => {
    const input = [sc('사과', 10), sc('딸기', 10), sc('바나나', 10)];
    const result = sortSongCategories(input);
    expect(result.map((c) => c.name)).toEqual(['딸기', '바나나', '사과']);
  });

  it('displayOrder가 null인 카테고리는 뒤쪽에 배치한다', () => {
    const input = [sc('Null순서', null), sc('있음', 5)];
    const result = sortSongCategories(input);
    expect(result[0].name).toBe('있음');
    expect(result[1].name).toBe('Null순서');
  });

  it('displayOrder가 모두 null이면 이름 가나다순으로 정렬한다', () => {
    const input = [sc('다'), sc('가'), sc('나')];
    const result = sortSongCategories(input);
    expect(result.map((c) => c.name)).toEqual(['가', '나', '다']);
  });

  it('혼합 상태: 있는 것 먼저(DESC), null은 뒤에(가나다순)', () => {
    const input = [
      sc('Null-나'),
      sc('순서3', 30),
      sc('Null-가'),
      sc('순서1', 10),
      sc('순서2', 20),
    ];
    const result = sortSongCategories(input);
    expect(result.map((c) => c.name)).toEqual([
      '순서3',
      '순서2',
      '순서1',
      'Null-가',
      'Null-나',
    ]);
  });

  it('undefined 입력 시 빈 배열을 반환한다', () => {
    expect(sortSongCategories(undefined)).toEqual([]);
  });

  it('빈 배열 입력 시 빈 배열을 반환한다', () => {
    expect(sortSongCategories([])).toEqual([]);
  });

  it('category 객체를 그대로 반환한다 (songCategory wrapper 제거)', () => {
    const input = [sc('테스트', 1)];
    const result = sortSongCategories(input);
    expect(result[0]).toHaveProperty('name', '테스트');
    expect(result[0]).toHaveProperty('displayOrder', 1);
    expect(result[0]).not.toHaveProperty('category');
  });
});
