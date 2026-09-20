# Third-party notices (apps/web)

This directory contains code adapted from third-party open source projects. Those portions remain
under their original licenses, reproduced below; the rogichat license (PolyForm Noncommercial 1.0.0)
applies only to rogichat's own code and does not relicense them. Runtime dependencies are installed
from npm under their own licenses and are not redistributed in this repository.

## shadcn/ui (MIT)

Files derived from the official shadcn/ui component templates (style `new-york`), hand-adapted to the
rogichat design tokens and the unified `radix-ui` package:

- `src/shared/ui/avatar.tsx`
- `src/shared/ui/badge.tsx`
- `src/shared/ui/button.tsx`
- `src/shared/ui/card.tsx`
- `src/shared/ui/input.tsx`
- `src/shared/ui/label.tsx`
- `src/shared/ui/separator.tsx`
- `src/shared/ui/sheet.tsx`
- `src/shared/ui/textarea.tsx`
- `src/shared/lib/cn.ts` (the `cn` helper)

Source: https://github.com/shadcn-ui/ui (component registry published through the `shadcn` CLI,
version 4.21.0 at the time of adaptation). License text retrieved 2026-09-20 from
https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md
(SHA-256 `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f`).

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies (not vendored)

License fields as published on the npm registry, checked 2026-09-20:
`radix-ui` 1.6.7 (MIT), `lucide-react` 1.47.0 (ISC), `class-variance-authority` 0.7.1 (Apache-2.0),
`clsx` 2.1.1 (MIT), `tailwind-merge` 3.7.0 (MIT), `tw-animate-css` 1.4.0 (MIT), `next` 16.3.5 (MIT),
`react` / `react-dom` 19.3.0 (MIT), `tailwindcss` 4.3.3 (MIT). Each package ships its own license file
in `node_modules`.

## meloming-front (internal, no open source license)

Selected UI structure was adapted from the dylabs internal `meloming-front` repository, which has no
LICENSE file. That adaptation is recorded per file in
[docs/frontend-web-reuse-ledger.md](../../docs/frontend-web-reuse-ledger.md); it is not a third-party
open source component and no open source notice applies to it.
