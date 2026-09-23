/**
 * Schedule template editor 의 공유 primitives.
 *
 * 메인 에디터는 `photoshop-editor/` 로 이동했으며, 이 폴더는 photoshop-editor 와
 * render 페이지 양쪽이 공유하는 저수준 컴포넌트/유틸만 보관한다.
 *
 *  - default-slots: 기본값 팩토리 + coerce + describeSlot
 *  - schedule-template-canvas-viewport: zoom/pan viewport
 *  - schedule-template-editor-canvas: 슬롯 드래그/리사이즈/마키 캔버스
 *  - schedule-template-editor-states: 로딩/에러 상태 컴포넌트
 *  - schedule-template-binding-field: binding DSL 입력 필드
 */
export {
  coerceTemplateSpec,
  createDefaultTextSlot,
  createDefaultImageSlot,
  createEmptyTemplateSpec,
  updateSlotById,
  describeSlot,
} from "./default-slots";
