import { createHash } from 'node:crypto';
/** No request/query/cookie argument: callback credentials never enter application code. */
export function mobileFallbackResponse() {
  const script = "history.replaceState(null,'','/mobile/auth/complete');";
  const style = 'body{margin:0;background:#fff;color:#222;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:12vh auto;padding:24px}h1{font-size:28px;line-height:1.3}a{display:inline-block;padding:12px 16px;border:1px solid #767676;border-radius:8px;color:#222;text-decoration:none}a:focus-visible{outline:3px solid #222;outline-offset:4px}';
  const hash = (value: string) => createHash('sha256').update(value).digest('base64');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>앱 로그인 확인 · 로기챗</title><script>${script}</script><style>${style}</style></head><body><main><h1>로기챗 앱으로 돌아가 주세요</h1><p>이 페이지에서는 로그인 결과를 확인하거나 로그인을 완료하지 않습니다.</p><p>앱이 열리지 않았다면 로기챗 앱으로 돌아가 다시 로그인을 시작해 주세요.</p><noscript><p>주소에 로그인 정보가 남아 있을 수 있습니다. 이 탭을 닫고 앱으로 돌아가 주세요.</p></noscript><a href="/" rel="noreferrer">로기챗 홈으로</a></main></body></html>`;
  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  } });
}
