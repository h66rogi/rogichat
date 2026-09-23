"use client";

import {
  GLOBAL_SERVICE_LOGO_SRC,
  getDefaultBase,
  type ServiceCategory,
  type ServiceId,
} from "@/meloming/shared/lib/service-routes";
import { type CSSProperties, type ReactNode } from "react";
import { RemoteServicePopover } from "./header/global-chrome-popovers";

type AccentVars = CSSProperties & Record<string, string>;

type GlobalThinHeaderProps = {
  activeService: ServiceId;
  accent?: string;
  onAccent?: string;
  logoSrc?: string;
  logoAlt?: string;
  homeHref?: string;
  border?: boolean;
  userSlot?: ReactNode;
  serviceSlot?: ReactNode;
  categories?: ServiceCategory[];
};

export function GlobalThinHeader({
  activeService,
  accent = "#5c53fc",
  onAccent = "#ffffff",
  logoSrc,
  logoAlt = "멜로밍",
  homeHref = getDefaultBase("portal"),
  border = false,
  userSlot,
  serviceSlot,
  categories,
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
          <span className="thin-header__symbol-fallback">M</span>
        )}
      </a>

      <div className="thin-header__actions">
        {userSlot}
        {serviceSlot ?? (
          <RemoteServicePopover
            activeService={activeService}
            logoSrc={GLOBAL_SERVICE_LOGO_SRC}
            categories={categories}
            variant="thin"
          />
        )}
      </div>
      </div>
    </header>
  );
}
