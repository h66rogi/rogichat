# NanumSquare Neo

These are unmodified static WOFF2 files distributed by NAVER under the SIL Open
Font License 1.1. The copyright notice and full license are in [OFL.txt](OFL.txt).

- Official distribution: https://campaign.naver.com/nanumsquare_neo/
- Official archive: https://campaign.naver.com/nanumsquare_neo/download/NaverNanumSquareNeo.zip
- Downloaded archive SHA-256: `aba166203bf7637324f1d923bcf9501eb276cfca044c1ad714ba06b1e61a15cc`
- License information: https://help.naver.com/service/11029/contents/18088?lang=ko&osType=PC

| Weight | Original file | SHA-256 |
| --- | --- | --- |
| 300 | `NanumSquareNeoTTF-aLt.woff2` | `f0da0f2329935d3f88f7e4162b68fcdc0be393f74398736ea0967594282ca4e2` |
| 400 | `NanumSquareNeoTTF-bRg.woff2` | `d13846b612acc829078aff4f91c272c637c08441b409d46bb1a4c802eb2967c3` |
| 700 | `NanumSquareNeoTTF-cBd.woff2` | `97dfe9720fbed813fc988fcedbcf741e97eef9353515b2043717484ec0b90aa1` |
| 800 | `NanumSquareNeoTTF-dEb.woff2` | `f27c0741248dba9a543520ff27eb32f9433de3ca50ac7ba4ccb5f5ede673c535` |
| 900 | `NanumSquareNeoTTF-eHv.woff2` | `090b017020c0b5a8fd517460c5dfdf33819b726e1c860313c75bf0624162242d` |

No conversion, renaming, or subsetting was performed. `src/app/fonts.ts`
registers the five static faces once with `next/font/local`; the root layout
exposes the generated CSS variable and the Tailwind `font-sans` theme token makes
the family the application-wide default. Do not add duplicate manual
`@font-face` or route-specific font overrides.

The static files are intentional: Windows Chrome and Edge must be validated with
CDP platform-font inspection because a font that loads on Linux Chromium can
still fail Windows OTS decoding and silently fall back to Malgun Gothic.
