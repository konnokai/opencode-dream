/**
 * 一次性把這個工作區的歷史 session 匯出到 .opencode/memory/sessions/。
 * 直接讀本機 opencode.db，所以 compaction 之前的訊息也會進來。
 */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { renderSession, isDreamSession } from "../plugins/dream.ts"

const MEMORY_DIR = path.join(".opencode", "memory")
const DREAM_TITLE = /^dream$/i
const CHUNK_CHARS = 110000
const MARKER = ".backfilled"

export const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

export const toMessages = (rows: Array<{ id: string; type: string; data: string }>) =>
  rows.map((row) => ({ ...JSON.parse(row.data), id: row.id, type: row.type }))

export const shouldSkip = (title: string, messages: Array<Record<string, any>>) =>
  !messages.some((message) => message.type === "user") ||
  isDreamSession(messages) ||
  DREAM_TITLE.test(title)

/** 一片 transcript 不能超過 renderSession 的 120000 上限，不然尾巴會被切掉。 */
export const chunkMessages = (messages: Array<Record<string, any>>, meta: { id: string; title?: string; directory?: string }) => {
  const chunks: Array<Array<Record<string, any>>> = []
  let current: Array<Record<string, any>> = []
  let size = 0
  for (const message of messages) {
    const cost = renderSession([message], meta).length
    if (current.length && size + cost > CHUNK_CHARS) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(message)
    size += cost
  }
  if (current.length) chunks.push(current)
  return chunks
}

const ensureGitignore = (memoryDir: string) => {
  const file = path.join(memoryDir, ".gitignore")
  const line = "sessions/"
  if (!existsSync(file)) {
    writeFileSync(file, `${line}\n`)
    return
  }
  const current = readFileSync(file, "utf8")
  if (current.split(/\r?\n/).some((entry) => entry.trim() === line)) return
  writeFileSync(file, `${current}${current.endsWith("\n") ? "" : "\n"}${line}\n`)
}

export const main = () => {
  const memoryDir = path.join(process.cwd(), MEMORY_DIR)
  if (!existsSync(memoryDir)) {
    console.log(`dream-backfill: 找不到 ${MEMORY_DIR}，先對這個專案跑 install.ps1 -Project <repo>`)
    return 1
  }

  const dbPath = process.env.OPENCODE_DB ?? path.join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(dbPath)) {
    console.log(`dream-backfill: 找不到 ${dbPath}，可用 OPENCODE_DB 指定`)
    return 1
  }

  const db = new Database(dbPath, { readonly: true })
  const sessions = db
    .query(
      "select id, title, directory from session_v2 where parent_id is null and fork_session_id is null and directory is not null order by time_created asc",
    )
    .all() as Array<{ id: string; title: string | null; directory: string }>
  const rowsFor = db.query("select id, type, data from session_message where session_id = ? order by seq asc")
  const wanted = normalize(process.cwd())

  const sessionsDir = path.join(memoryDir, "sessions")
  mkdirSync(sessionsDir, { recursive: true })
  ensureGitignore(memoryDir)

  const markerFile = path.join(sessionsDir, MARKER)
  const done = new Set(
    existsSync(markerFile)
      ? readFileSync(markerFile, "utf8")
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
  )
  const newlyDone: string[] = []

  let written = 0
  let skipped = 0
  let bytes = 0
  for (const session of sessions) {
    if (!session.directory || normalize(session.directory) !== wanted) continue
    if (done.has(session.id)) {
      skipped++
      continue
    }
    const messages = toMessages(rowsFor.all(session.id) as Array<{ id: string; type: string; data: string }>)
    if (!messages.length || shouldSkip(session.title ?? "", messages)) {
      skipped++
      continue
    }
    const meta = { id: session.id, title: session.title ?? undefined, directory: session.directory }
    for (const chunk of chunkMessages(messages, meta)) {
      const lastID = String(chunk[chunk.length - 1].id ?? "")
      if (!lastID) continue
      const file = path.join(sessionsDir, `${session.id}-${lastID.replace(/[^\w.-]/g, "_")}.md`)
      if (existsSync(file)) continue
      const body = renderSession(chunk, meta)
      writeFileSync(file, body)
      written++
      bytes += body.length
    }
    newlyDone.push(session.id)
  }
  rowsFor.finalize()
  db.close()
  if (newlyDone.length) writeFileSync(markerFile, [...done, ...newlyDone].join("\n") + "\n")

  console.log(
    `dream-backfill: 匯出 ${written} 片 transcript 到 ${path.relative(process.cwd(), sessionsDir)}（${(bytes / 1024).toFixed(0)} KB），略過 ${skipped} 個 session。接著跑 /dream。`,
  )
  return 0
}

if (import.meta.main) process.exit(main())
