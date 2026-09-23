"use client";

import {
  GLOBAL_SERVICE_LOGO_SRC,
  getDefaultBase,
  getServiceLabel,
  type ServiceCategory,
  type ServiceId,
} from "@/meloming/shared/lib/service-routes";
import Link from "next/link";
import { type CSSProperties, type ReactNode } from "react";
import { RemoteServicePopover } from "./header/global-chrome-popovers";

type GlobalHeaderProps = {
  activeService: ServiceId;
  /** wordmark shown after "멜로밍" (defaults to the active service's label) */
  title?: string;
  /** brand prefix shown before title (defaults to "멜로밍"; pass null to hide) */
  brandPrefix?: string | null;
  /** brand accent — logo box background + active highlight (per service) */
  accent?: string;
  /** text color on the accent box (defaults to white) */
  onAccent?: string;
  /** optional logo image inside the accent box (falls back to "M") */
  logoSrc?: string;
  logoAlt?: string;
  logoVariant?: "symbol" | "wordmark";
  /** optional brand image fallback when logoSrc is not provided */
  wordmarkSrc?: string;
  wordmarkAlt?: string;
  /** where the logo links (defaults to "/") */
  homeHref?: string;
  navSlot?: ReactNode;
  userSlot?: ReactNode;
  serviceSlot?: ReactNode;
  categories?: ServiceCategory[];
};

type AccentVars = CSSProperties & Record<string, string>;

export function GlobalHeader({
  activeService,
  title,
  brandPrefix = "멜로밍",
  accent = "#5c53fc",
  onAccent = "#ffffff",
  logoSrc,
  logoAlt = "멜로밍",
  logoVariant = "symbol",
  wordmarkSrc,
  wordmarkAlt = "멜로밍",
  homeHref = getDefaultBase("portal"),
  navSlot,
  userSlot,
  serviceSlot,
  categories,
}: GlobalHeaderProps) {
  const label = title ?? getServiceLabel(activeService);
  const brandLogo = logoSrc ?? wordmarkSrc;
  const symbolClassName = [
    "brand-symbol",
    brandLogo ? "brand-symbol--image" : "",
    brandLogo && logoVariant === "wordmark" ? "brand-symbol--wordmark" : "",
  ].filter(Boolean).join(" ");

  return (
    <header
      className="brand-header"
      style={{ "--brand-accent": accent, "--brand-on-accent": onAccent } as AccentVars}
    >
      <div className="brand-mark">
        <a className="brand-symbol-link" href={homeHref}>
          <span className={symbolClassName}>
            {brandLogo ? (
              <img
                className="brand-symbol__img"
                src={brandLogo}
                alt={logoSrc ? logoAlt : wordmarkAlt}
              />
            ) : (
              "M"
            )}
          </span>
        </a>
        <Link className="brand-name" href="/">
          {brandPrefix ? <span>{brandPrefix}</span> : null}
          <b className="brand-suffix">{label}</b>
        </Link>
      </div>

      {navSlot ? <div className="brand-header-nav">{navSlot}</div> : null}

      <div className="brand-header-actions">
        {userSlot}
        {serviceSlot ?? (
          <RemoteServicePopover
            activeService={activeService}
            logoSrc={GLOBAL_SERVICE_LOGO_SRC}
            categories={categories}
          />
        )}
      </div>
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <main className="page-shell">{children}</main>;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="section-heading">
      {eyebrow ? <p className="section-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
