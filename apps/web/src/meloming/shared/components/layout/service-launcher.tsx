"use client";

import {
  getServiceCategories,
  type ServiceCategory,
  type ServiceId,
} from "@/meloming/shared/lib/service-routes";
import { useId, useRef, useState } from "react";
import { ServiceLauncherPanel } from "./service-launcher-panel";

export type ServiceLauncherVariant = "default" | "thin" | "home";

export type ServiceLauncherProps = {
  activeService: ServiceId;
  logoSrc?: string;
  categories?: ServiceCategory[];
  variant?: ServiceLauncherVariant;
};

export function ServiceLauncher({
  activeService,
  logoSrc,
  categories = getServiceCategories(),
  variant = "default",
}: ServiceLauncherProps) {
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className={`svc-launcher${variant === "home" ? " svc-launcher--left" : ""}`}>
      {variant === "home" ? (
        <button
          id={buttonId}
          ref={buttonRef}
          className="size-12 flex items-center justify-center rounded-full hover:bg-[#f5f5f5] dark:hover:bg-[#333] transition-colors"
          type="button"
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="전체 서비스 메뉴"
          onClick={() => setOpen((value) => !value)}
        >
          <svg className="size-7 text-[#222] dark:text-[#ccc]" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      ) : variant === "thin" ? (
        <button
          id={buttonId}
          ref={buttonRef}
          className={`thin-header__grid-btn ${open ? "is-open" : ""}`}
          type="button"
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="전체 서비스 메뉴"
          onClick={() => setOpen((value) => !value)}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      ) : (
        <button
          id={buttonId}
          ref={buttonRef}
          className={`svc-launcher__btn ${open ? "is-open" : ""}`}
          type="button"
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="전체 서비스 메뉴"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="svc-launcher__label-full">전체 서비스</span>
          <span className="svc-launcher__label-short">서비스</span>
          <svg className="svc-launcher__caret" aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}

      {open ? (
        <ServiceLauncherPanel
          panelId={panelId}
          buttonId={buttonId}
          activeService={activeService}
          logoSrc={logoSrc}
          onClose={closeMenu}
          categories={categories}
        />
      ) : null}
    </div>
  );
}
