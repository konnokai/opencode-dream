# opencode-dream

把 session 的新訊息匯出成 markdown，再由 `/dream` 蒸餾成專案記憶。
記憶放在 repo 裡，所以會跟著 git 到另一台裝置。

## 檔案

```
global/plugins/dream.ts          全域 plugin：增量匯出 transcript、注入記憶索引
global/commands/dream.md         /dream 指令：整理 transcript
global/commands/dream-backfill.md  /dream-backfill 指令：一次性匯出所有歷史 session
global/scripts/dream-backfill.ts   回填腳本：讀本機 opencode.db
global/agents/dream.md           dream agent：只能讀，以及寫 .opencode/memory
project/.agents/loops/dream.md   每晚 03:00 跑到清空再 commit + push 的 loop
install.ps1                      安裝到這台機器
test/render.test.js              渲染、增量、redact 的測試
test/plugin.test.js              plugin 接線的測試
test/backfill.test.js            回填腳本的測試
```

測試需要 Bun。執行 `bun test test`。

## 安裝

```powershell
.\install.ps1 -Project "C:\work\project-a","C:\work\project-b"
```

會做四件事：

1. 複製 `dream.ts` 到 `~/.config/opencode/plugins/`
2. 複製 `global/commands/*.md` 到 `~/.config/opencode/commands/`
3. 複製 `dream.md` 到 `~/.config/opencode/agents/`
4. 複製 `dream-backfill.ts` 到 `~/.config/opencode/scripts/`
5. 在每個專案建立 `.opencode/memory/.gitignore` 和 `.agents/loops/dream.md`

內容相同的檔案不會重寫。不同的會先備份成 `.bak-yyyyMMdd-HHmmss`。

只裝全域、不碰專案：

```powershell
.\install.ps1
```

只準備專案、暫不動 `~/.config/opencode`：

```powershell
.\install.ps1 -SkipGlobal -Project "C:\work\project-a"
```

## 專案 opt-in

plugin 只在 `<project>/.opencode/memory/` 存在時動作。沒建這個資料夾的專案完全不受影響。

想手動開一個新專案：

```powershell
New-Item -ItemType Directory -Force .opencode\memory
Set-Content .opencode\memory\.gitignore "sessions/"
```

## 舊專案第一次作夢

plugin 只匯出裝好之後結束的 session，舊的不回填。要讓舊專案有第一批記憶，
在那個專案的工作區打一次 `/dream-backfill`，再打 `/dream`。

`/dream-backfill` 直接讀本機 `opencode.db`，把該工作區所有根 session 的完整對話
（含 compaction 之前的訊息）切成 110000 字元以內的片，寫成
`sessions/<sessionID>-<lastMessageID>.md`。格式和 plugin 匯出的一樣，所以 `/dream` 可以直接消化；
分片是為了不被 `renderSession` 的 120000 字元上限切掉尾巴（單一工具結果仍會截到 4000 字元）。

- 只處理 `.opencode/memory/` 已存在的專案；沒有就先跑 `install.ps1 -Project <repo>`。
- 子 session、fork、dream session、沒有使用者訊息的 session 會略過；已封存（archived）的舊 session 會匯出。
- 檔名已存在就略過，重跑不會覆寫。處理過的 session id 記在 `sessions/.backfilled`，
  所以 `/dream` 清掉 `.md` 之後重跑也不會把整段歷史再吐一次。
- 需要 Bun（讀 SQLite）。資料庫路徑可用 `OPENCODE_DB` 覆寫。
- 指令的 shell block 用 `$HOME` 找全域設定目錄；本機設定的 shell 是 PowerShell 7。
  換成別的 shell 時，改 `global/commands/dream-backfill.md` 那一行。
- 回填不寫 `ctx.storage`，所以下一次 session 結束會再長出一片 delta，屬正常增量。
- 舊專案 session 多時，`sessions/` 可能很大。`/dream` 一次最多處理 4 片 transcript，
  手動跑要跑好幾次（一片最大 120 KB，4 片就接近 200 KB，再往上會爆 context）。
  交給 loop 就不用管，它會一輪一輪跑到清空。

## 每天怎麼跑

- 每個 session 結束時，plugin 只把上次之後的新訊息寫成一片
  `.opencode/memory/sessions/<sessionID>-<lastMessageID>.md`
- `/dream` 讀掉這些片段，更新 `.opencode/memory/*.md` 和 `_index.md`
- `/dream` 把處理過的檔名寫進 `sessions/.processed`，那個 subagent session 結束時 plugin 刪掉
- 下一個 session 的 system prompt 會自動帶上 `_index.md`

loop 檔是 `enabled: false`。第一次要到 OpenChamber 的 Scheduled Tasks 核准再打開。
loop 檔改過之後，OpenChamber 會把任務標成待核准並停用，要回去重新核准一次，
不然 03:00 不會跑。

loop 開著的話，它不只跑一次 `/dream` 就停：

1. 一輪最多 4 片，dream 寫 `.processed`，plugin 在 subagent 結束時刪掉
2. 還有 `.md` 就直接下一輪，不問人
3. 清空（或提前停下）之後才 `git add .opencode/memory`、commit、push

所以 03:00 之後記憶就上去了，不用隔天再手動補。commit 只碰 `.opencode/memory/`，
工作區其他沒 commit 的東西不動，也不合併回主分支。
push 只在三個條件都成立時做：在分支上、有 upstream、領先剛好 1 個 commit。
其他情況只 commit 不 push，免得順手把還沒整理的 commit 推出去。
subagent 失敗、片數沒變少、git 出錯，loop 會停下來回報，不會硬幹。

## 兩台裝置

**常駐那台**：loop 打開後每天 03:00 跑，不用管。

**偶爾開那台**：cron 打不到你開機的時間，所以收工前手動打 `/dream`，然後 commit + push。

loop 會自己 commit + push；手動 `/dream` 只寫檔，commit 和 push 由你決定。

transcript 留在本機，不進 git。所以兩台的 `sessions/` 各自獨立，不會互相覆蓋。
plugin 的「上次匯出到哪」也存在本機，所以同一段對話不會因為換裝置被重複消化。

## 權限

`dream` agent 是 subagent，權限表是白名單：

- 可以讀、glob、grep
- 只能寫 `.opencode/memory/**`
- 不能 shell、webfetch、websearch、叫子 agent、問問題

transcript 裡的 prompt injection 就算說服模型，也改不了權限。

## 注意

- transcript 會有 API key、連線字串。plugin 會先用 regex 遮蔽常見格式，`sessions/` 也 gitignore，但不能保證百分之百。
  loop 開著等於半夜自動把記憶 push 出去，redaction 漏掉的就一起上去了。介意就把 loop 關掉手動跑。
- `/dream` 用的是 `opencode-go/deepseek-v4.1-flash`。如果原本 session 用別家 provider，等於把 transcript 送給第三家。介意就把 loop 改成同一家。
- 只匯出裝好之後結束的 session。舊的靠 `/dream-backfill` 手動回填。
- `session.context` 只給「最後一次 compaction 之後」的訊息，所以 compaction 之前的內容不會進 transcript。
- 子 session（subagent）不匯出，最後回覆會在上層的工具結果裡。
- 根目錄的 `.gitignore` 不能忽略 `.opencode/`，不然記憶不會同步。`install.ps1` 會用 `git check-ignore` 提醒。
- 如果專案根目錄不是 git repo，記憶不會自動同步。要同步就把 `.opencode/memory/` 放進其中一個子 repo，或給根目錄一個 repo。

## 移除

```powershell
Remove-Item "$env:USERPROFILE\.config\opencode\plugins\dream.ts"
Remove-Item "$env:USERPROFILE\.config\opencode\commands\dream.md"
Remove-Item "$env:USERPROFILE\.config\opencode\agents\dream.md"
```

專案裡的 `.opencode/memory/` 和 `.agents/loops/dream.md` 自己決定要不要留。
