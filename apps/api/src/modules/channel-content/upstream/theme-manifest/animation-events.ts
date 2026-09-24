/**
 * Standard animation events emitted by the overlay system.
 *
 * REQUIRED_ANIMATION_EVENTS must be defined by every theme.
 * OPTIONAL_ANIMATION_EVENTS may be omitted; in that case the
 * default fade animation is applied at runtime.
 */

export const REQUIRED_ANIMATION_EVENTS = [
  'track.change',
  'chat.enter',
  'queue.add',
  'donation',
] as const;

export const OPTIONAL_ANIMATION_EVENTS = ['chat.exit', 'queue.remove'] as const;

export type RequiredAnimationEvent = (typeof REQUIRED_ANIMATION_EVENTS)[number];
export type OptionalAnimationEvent = (typeof OPTIONAL_ANIMATION_EVENTS)[number];

export type ThemeAnimationEvent =
  | RequiredAnimationEvent
  | OptionalAnimationEvent;

export const ALL_ANIMATION_EVENTS: readonly ThemeAnimationEvent[] = [
  ...REQUIRED_ANIMATION_EVENTS,
  ...OPTIONAL_ANIMATION_EVENTS,
];

export function isRequiredAnimationEvent(
  value: string,
): value is RequiredAnimationEvent {
  return (REQUIRED_ANIMATION_EVENTS as readonly string[]).includes(value);
}

export function isOptionalAnimationEvent(
  value: string,
): value is OptionalAnimationEvent {
  return (OPTIONAL_ANIMATION_EVENTS as readonly string[]).includes(value);
}

export function isThemeAnimationEvent(
  value: string,
): value is ThemeAnimationEvent {
  return isRequiredAnimationEvent(value) || isOptionalAnimationEvent(value);
}
