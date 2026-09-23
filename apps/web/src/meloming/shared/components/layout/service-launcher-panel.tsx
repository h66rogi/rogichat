"use client";

import { useEffect } from "react";
import {
  GLOBAL_SERVICE_LOGO_SRC,
  getGlobalServiceHref,
  getServiceCategories,
  type ServiceCategory,
  type ServiceId,
} from "@/meloming/shared/lib/service-routes";

type Props = {
  panelId: string;
  buttonId: string;
  activeService?: ServiceId;
  /** @deprecated The launcher owns the canonical Meloming logo. */
  logoSrc?: string;
  onClose: () => void;
  categories?: ServiceCategory[];
};

/**
 * "전체 서비스" 드롭다운 패널(스크림 + svc-panel). GlobalHeader / GlobalThinHeader /
 * 홈 검색바 등 svc-launcher 트리거를 가진 곳이면 어디서나 재사용한다. 트리거 버튼과
 * open 상태는 호출측이 관리하고, 이 컴포넌트는 open인 동안에만 마운트된다.
 */
export function ServiceLauncherPanel({
  panelId,
  buttonId,
  activeService,
  onClose,
  categories = getServiceCategories(),
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const serviceCategories = categories;

  return (
    <>
      <button className="svc-scrim" type="button" aria-label="전체 서비스 메뉴 닫기" onClick={onClose} />
      <div id={panelId} className="svc-panel" role="menu" aria-labelledby={buttonId}>
        <a
          role="menuitem"
          aria-current={activeService === "portal" ? "page" : undefined}
          className={`svc-home-link ${activeService === "portal" ? "svc-link--active" : ""}`}
          href={getGlobalServiceHref("portal")}
          onClick={onClose}
        >
          <span className="svc-home-icon" aria-hidden>
            <img src={GLOBAL_SERVICE_LOGO_SRC} alt="" />
          </span>
          <span className="svc-home-copy">
            <strong>멜로밍</strong>
            <small>모든 서비스를 한곳에서 만나보세요</small>
          </span>
          <span className="svc-home-arrow" aria-hidden>→</span>
        </a>

        <div className="svc-panel__grid">
          {serviceCategories.map((cat, index) => {
            const categoryTitleId = `${panelId}-category-${index}`;
            return (
              <div
                className="svc-cat"
                key={cat.title}
                role="group"
                aria-labelledby={categoryTitleId}
              >
                <p className="svc-cat__title" id={categoryTitleId}>
                  {cat.title}
                </p>
                <div className="svc-cat__links">
                  {cat.links.map((link) => (
                    <a
                      key={link.id}
                      role="menuitem"
                      aria-current={
                        link.id === activeService ? "page" : undefined
                      }
                      className={`svc-link ${
                        link.id === activeService ? "svc-link--active" : ""
                      }`}
                      href={link.href}
                      onClick={onClose}
                    >
                      {link.label}
                      <span className="svc-link__arrow" aria-hidden>→</span>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
