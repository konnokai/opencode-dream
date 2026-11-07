import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { main } from "../global/scripts/dream-backfill.ts"

const setup = (dir, dbPath) => {
  mkdirSync(path.join(dir, ".opencode", "memory"), { recursive: true })
  const db = new Database(dbPath)
  db.exec(`
    create table session_v2 (id text, title text, directory text, parent_id text, fork_session_id text, time_created integer);
    create table session_message (id text, session_id text, type text, seq integer, time_created integer, data text);
  `)
  return db
}

test("回填目前工作區的歷史 session，略過子 session、fork、別的目錄與 dream session", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-backfill-"))
  const dbDir = mkdtempSync(path.join(tmpdir(), "dream-backfill-db-"))
  const previousCwd = process.cwd()
  const previousDB = process.env.OPENCODE_DB
  const dbPath = path.join(dbDir, "opencode.db")
  const db = setup(dir, dbPath)

  // 真實 DB 存的是正斜線，測試要真的走過 normalize。
  const storedDir = dir.replace(/\\/g, "/")
  const add = db.prepare("insert into session_v2 values (?, ?, ?, ?, ?, ?)")
  add.run("ses_a", "fix login", storedDir, null, null, 100)
  add.run("ses_child", "child", storedDir, "ses_a", null, 101)
  add.run("ses_fork", "fork", storedDir, null, "ses_a", 102)
  add.run("ses_other", "other project", storedDir + "/elsewhere", null, null, 103)
  add.run("ses_dream", "dream 2026-11-07 03:00", storedDir, null, null, 104)

  const msg = db.prepare("insert into session_message values (?, ?, ?, ?, ?, ?)")
  msg.run("m1", "ses_a", "user", 1, 100, JSON.stringify({ time: { created: 100 }, text: "fix login" }))
  msg.run(
    "m2",
    "ses_a",
    "assistant",
    2,
    200,
    JSON.stringify({
      time: { created: 200 },
      agent: "build",
      content: [{ type: "tool", name: "shell", state: { status: "completed", input: {}, content: [{ type: "text", text: "3 pass" }] } }],
    }),
  )
  msg.run("m3", "ses_child", "user", 3, 101, JSON.stringify({ time: { created: 101 }, text: "child work" }))
  msg.run("m4", "ses_fork", "user", 4, 102, JSON.stringify({ time: { created: 102 }, text: "fork work" }))
  msg.run("m5", "ses_other", "user", 5, 103, JSON.stringify({ time: { created: 103 }, text: "other work" }))
  msg.run(
    "m6",
    "ses_dream",
    "user",
    6,
    104,
    JSON.stringify({ time: { created: 104 }, text: "<!-- opencode-dream:skip -->\nYou are the dream" }),
  )
  db.close()

  try {
    process.chdir(dir)
    process.env.OPENCODE_DB = dbPath
    expect(main()).toBe(0)

    const sessionsDir = path.join(dir, ".opencode", "memory", "sessions")
    expect(readdirSync(sessionsDir).filter((name) => name.endsWith(".md"))).toEqual(["ses_a-m2.md"])
    const body = readFileSync(path.join(sessionsDir, "ses_a-m2.md"), "utf8")
    expect(body).toContain("USER:")
    expect(body).toContain("fix login")
    expect(body).toContain("3 pass")
    expect(readFileSync(path.join(dir, ".opencode", "memory", ".gitignore"), "utf8")).toContain("sessions/")

    // 重跑不覆寫；/dream 刪掉 .md 之後也不會把整段歷史再吐一次。
    expect(main()).toBe(0)
    rmSync(path.join(sessionsDir, "ses_a-m2.md"))
    expect(main()).toBe(0)
    expect(readdirSync(sessionsDir).filter((name) => name.endsWith(".md"))).toEqual([])
  } finally {
    process.chdir(previousCwd)
    if (previousDB === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = previousDB
    rmSync(dir, { recursive: true, force: true })
    // Windows 上 SQLite 檔案可能還被 bun:sqlite 握著，刪不掉就留給系統清理。
    try {
      rmSync(dbDir, { recursive: true, force: true })
    } catch {}
  }
})

test("長 session 切成多片，尾巴不會被截掉", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-backfill-long-"))
  const dbDir = mkdtempSync(path.join(tmpdir(), "dream-backfill-long-db-"))
  const previousCwd = process.cwd()
  const previousDB = process.env.OPENCODE_DB
  const dbPath = path.join(dbDir, "opencode.db")
  const db = setup(dir, dbPath)
  const storedDir = dir.replace(/\\/g, "/")
  db.prepare("insert into session_v2 values (?, ?, ?, ?, ?, ?)").run("ses_long", "long", storedDir, null, null, 100)
  const msg = db.prepare("insert into session_message values (?, ?, ?, ?, ?, ?)")
  msg.run("l0", "ses_long", "user", 0, 100, JSON.stringify({ time: { created: 100 }, text: "start" }))
  const big = "x".repeat(3900)
  for (let i = 1; i <= 40; i++) {
    msg.run(
      `l${i}`,
      "ses_long",
      "assistant",
      i,
      100 + i,
      JSON.stringify({
        time: { created: 100 + i },
        agent: "build",
        content: [{ type: "text", text: big }],
      }),
    )
  }
  db.close()

  try {
    process.chdir(dir)
    process.env.OPENCODE_DB = dbPath
    expect(main()).toBe(0)
    const sessionsDir = path.join(dir, ".opencode", "memory", "sessions")
    const files = readdirSync(sessionsDir).filter((name) => name.endsWith(".md"))
    expect(files.length).toBeGreaterThan(1)
    const all = files.map((name) => readFileSync(path.join(sessionsDir, name), "utf8")).join("\n")
    expect(all).toContain("start")
    expect(all).toContain(big)
    expect(all).not.toContain("chars truncated")
  } finally {
    process.chdir(previousCwd)
    if (previousDB === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = previousDB
    rmSync(dir, { recursive: true, force: true })
    try {
      rmSync(dbDir, { recursive: true, force: true })
    } catch {}
  }
})

test("沒有 .opencode/memory/ 就回傳錯誤碼", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-backfill-off-"))
  const previousCwd = process.cwd()
  try {
    process.chdir(dir)
    expect(main()).toBe(1)
  } finally {
    process.chdir(previousCwd)
    rmSync(dir, { recursive: true, force: true })
  }
})
