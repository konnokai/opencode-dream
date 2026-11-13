---
description: 把這個工作區的所有歷史 session 匯出成 transcript，供首次 /dream 使用
---
!`[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source ?? "$HOME\.bun\bin\bun.exe"; if (-not (Test-Path -LiteralPath $bun)) { "bun 找不到：先安裝 bun（https://bun.sh），再重跑 /dream-backfill。"; exit 0 }; & $bun "$HOME/.config/opencode/scripts/dream-backfill.ts"`

上面是回填結果。用一行回報匯出幾個 session，不要改任何檔案。有匯出就接著跑 `/dream` 消化 transcript；如果輸出是 bun 找不到，照它講的回報，不要跑 `/dream`。
