import Link from "next/link";
import { routes, SUPPORT_CENTER_URL } from "@/meloming/shared/lib/service-routes";

type FooterLink = {
  label: string;
  href: string;
  isExternal?: boolean;
  isEmphasized?: boolean;
};

const footerLinks: readonly FooterLink[] = [
  {
    label: "회사 소개",
    href: "https://dylabs.app",
    isExternal: true,
  },
  {
    label: "고객센터",
    href: SUPPORT_CENTER_URL,
    isExternal: true,
  },
  {
    label: "서비스 이용약관",
    href: routes.policy.terms(),
    isExternal: true,
  },
  {
    label: "개인정보 처리방침",
    href: routes.policy.privacy(),
    isExternal: true,
    isEmphasized: true,
  },
  {
    label: "유료서비스 이용약관",
    href: routes.policy.paidService(),
    isExternal: true,
  },
];

export default function Footer() {
  return (
    <footer
      id="global-footer"
      className="border-t border-border bg-background pretendard"
    >
      <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <nav aria-label="푸터 메뉴">
          <ul className="flex flex-wrap items-center justify-center gap-y-2 text-sm text-foreground">
            {footerLinks.map((item, index) => (
              <li key={item.label} className="flex items-center">
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="mx-2.5 text-border sm:mx-3"
                  >
                    |
                  </span>
                )}
                <Link
                  href={item.href}
                  target={item.isExternal ? "_blank" : undefined}
                  rel={item.isExternal ? "noopener noreferrer" : undefined}
                  className={
                    item.isEmphasized
                      ? "font-semibold transition-colors hover:text-foreground/70"
                      : "transition-colors hover:text-foreground/70"
                  }
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 space-y-2 text-center text-xs leading-relaxed text-muted-foreground">
          <p>
            <a
              href="https://dylabs.app"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              디와이랩스
            </a>
            {" | 대표 조현우 | 사업자등록번호 : 364-04-03272 "}
            <a
              href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=3640403272"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground hover:underline"
            >
              (사업자 정보 확인)
            </a>
            {" | 통신판매업신고번호 : 2025-서울송파-3012"}
          </p>
          <p>
            주소 : 서울특별시 송파구 법원로8길 8, 617호 (문정동, 문정역2차 SK
            V1) | 고객센터 :{" "}
            <a
              href="mailto:meloming@dylabs.app"
              className="transition-colors hover:text-foreground"
            >
              meloming@dylabs.app
            </a>{" "}
            (
            <a
              href="tel:070-4581-7104"
              className="transition-colors hover:text-foreground"
            >
              070-4581-7104
            </a>
            )
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          © DYLabs. All Rights Reserved.
        </p>
      </div>
    </footer>
  );
}
