# Google Sans Flex provenance

Official open-source Google brand font, downloaded 2026-10-07 from Google Fonts CSS API and fonts.gstatic.com. Unmodified variable WOFF2 files cover Latin, Latin Extended and Vietnamese, weight 1–1000 and optical size 6–144. Chinese follows the observed Google Cloud console native fallback: PingFang SC on macOS and Microsoft YaHei on Windows take priority; locally hosted Noto Sans SC remains the fallback when those OS fonts are unavailable. Roboto remains a fallback for other scripts. Shared page and AG Grid typography use the same CSS font stack.

Reference inspected on 2026-10-07: the public Google Cloud console Marketplace and its CloudConsoleWeb stylesheet. Its newer CM3 type tokens use Google Sans Flex throughout; legacy components still use Google Sans and Roboto. The browser confirmed native PingFang SC glyphs for Chinese. This observation is not a claim that every authenticated Cloud console page uses one font.

- Official Google Design announcement: https://design.google/library/google-sans-flex-font
- Source repository: https://github.com/googlefonts/googlesans-flex
- License: `GoogleSansFlex-OFL.txt` (SIL OFL 1.1, no Reserved Font Names)
- API: https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,1..1000&display=swap

No remote font requests are made by the application. Files are original Google Fonts subsets; they are not private Product Sans files extracted from Google applications.
