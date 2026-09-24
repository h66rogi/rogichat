import type { AnimationDef } from '../types';

const injectedStyles = new Map<string, HTMLStyleElement>();

/**
 * Generate a namespaced animation name: {themeId}-{animationName}
 * Used to prevent collision between themes' keyframes.
 */
export function namespacedAnimationName(themeId: string, name: string): string {
  return `${themeId}-${name}`;
}

/**
 * Inject inline @keyframes CSS for a theme. The CSS string in AnimationDef.css
 * is wrapped with the namespaced name. Multiple injections for the same key are dedup'd.
 *
 * Returns the namespaced animation name for use in CSS animation property.
 */
export function injectAnimationCss(
  themeId: string,
  animationName: string,
  cssKeyframes: string
): string {
  const namespaced = namespacedAnimationName(themeId, animationName);

  if (injectedStyles.has(namespaced)) {
    return namespaced;
  }

  // Wrap user-provided CSS with the namespaced @keyframes name
  // Allow user to provide either:
  //   - "0% { ... } 100% { ... }" (just the body) — wrap it
  //   - "@keyframes someName { ... }" — replace someName with namespaced
  let css: string;
  if (cssKeyframes.trim().startsWith('@keyframes')) {
    // Replace any existing keyframes name with our namespaced one
    css = cssKeyframes.replace(/@keyframes\s+[\w-]+/, `@keyframes ${namespaced}`);
  } else {
    css = `@keyframes ${namespaced} { ${cssKeyframes} }`;
  }

  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-theme-animation', namespaced);
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  injectedStyles.set(namespaced, styleEl);

  return namespaced;
}

/**
 * Remove all injected animations for a theme. Called during theme transition.
 */
export function cleanupThemeAnimations(themeId: string): void {
  const prefix = `${themeId}-`;
  for (const [key, styleEl] of injectedStyles.entries()) {
    if (key.startsWith(prefix)) {
      styleEl.remove();
      injectedStyles.delete(key);
    }
  }
}

/**
 * Remove all injected animations across all themes. For testing/cleanup.
 */
export function clearAllAnimations(): void {
  for (const styleEl of injectedStyles.values()) {
    styleEl.remove();
  }
  injectedStyles.clear();
}

/**
 * Build the CSS `animation` shorthand from an AnimationDef.
 * Example: "fade 300ms ease-out 0ms 1 forwards"
 */
export function buildAnimationShorthand(
  def: AnimationDef,
  themeId: string,
  phase: 'enter' | 'exit' = 'enter'
): string {
  const namespaced = namespacedAnimationName(themeId, def.name);
  const duration = phase === 'exit' && def.exitDuration !== undefined
    ? def.exitDuration
    : def.enterDuration;
  const easing = def.easing ?? 'ease-out';
  const delay = def.delay ?? 0;
  const iterations = def.iterations ?? 1;

  return `${namespaced} ${duration}ms ${easing} ${delay}ms ${iterations} forwards`;
}
