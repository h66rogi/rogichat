"use client";

import { type CSSProperties, type ReactNode } from "react";

type AccentVars = CSSProperties & Record<string, string>;

type GlobalThinHeaderProps = {
  accent?: string;
  onAccent?: string;
  logoSrc?: string;
  logoAlt?: string;
  homeHref?: string;
  border?: boolean;
  userSlot?: ReactNode;
};

export function GlobalThinHeader({
  accent = "#5c53fc",
  onAccent = "#ffffff",
  logoSrc,
  logoAlt = "로기챗",
  homeHref = "/",
  border = false,
  userSlot,
}: GlobalThinHeaderProps) {
  return (
    <header
      className={`thin-header${border ? " thin-header--border" : ""}`}
      style={{ "--brand-accent": accent, "--brand-on-accent": onAccent } as AccentVars}
    >
      <div className="thin-header__container">
      <a className="thin-header__logo" href={homeHref} aria-label={logoAlt}>
        {logoSrc ? (
          <img className="thin-header__logo-img" src={logoSrc} alt={logoAlt} />
        ) : (
          <span className="thin-header__symbol-fallback">R</span>
        )}
        <span className="text-sm font-semibold text-foreground">로기챗</span>
      </a>

      <div className="thin-header__actions">
        {userSlot}
      </div>
      </div>
    </header>
  );
}
