import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import plugin from "../global/plugins/dream.ts"

const waitFor = async (check, timeout = 800) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

const makeCtx = (dir, messages, title = "work", eventType = "session.execution.succeeded") => {
  const storage = new Map()
  let hook
  return {
    ctx: {
      location: { directory: dir },
      storage: {
        get: async (key) => storage.get(key),
        set: async (key, value) => storage.set(key, value),
      },
      session: {
        get: async () => ({ id: "ses_1", title, location: { directory: dir } }),
        context: async () => messages,
        hook: async (_name, fn) => {
          hook = fn
          return { dispose: async () => {} }
        },
      },
      event: {
        subscribe: async function* ({ signal, types }) {
          if (!types || types.includes(eventType)) {
            yield { type: eventType, data: { sessionID: "ses_1" } }
          }
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
        },
      },
    },
    getHook: () => hook,
  }
}

const work = [
  { id: "m1", type: "user", text: "run the tests", time: { created: 100 } },
  {
    id: "m2",
    type: "assistant",
    agent: "build",
    time: { created: 200 },
    content: [{ type: "tool", name: "shell", state: { status: "completed", input: {}, content: [{ type: "text", text: "3 pass" }] } }],
  },
]

test("exports a session into the memory folder", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-export-"))
  mkdirSync(path.join(dir, ".opencode", "memory"), { recursive: true })
  const { ctx } = makeCtx(dir, work)
  const cleanup = await plugin.setup(ctx)

  const sessions = path.join(dir, ".opencode", "memory", "sessions")
  const file = path.join(sessions, "ses_1-m2.md")
  expect(await waitFor(() => existsSync(file))).toBe(true)
  expect(readFileSync(file, "utf8")).toContain("3 pass")
  expect(readFileSync(path.join(sessions, "..", ".gitignore"), "utf8")).toContain("sessions/")

  await cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("exports after a failed execution", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-failed-"))
  mkdirSync(path.join(dir, ".opencode", "memory"), { recursive: true })
  const { ctx } = makeCtx(dir, work, "work", "session.execution.failed")
  const cleanup = await plugin.setup(ctx)
  expect(await waitFor(() => existsSync(path.join(dir, ".opencode", "memory", "sessions", "ses_1-m2.md")))).toBe(true)
  await cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("prunes processed transcripts and injects the index", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-prune-"))
  const memory = path.join(dir, ".opencode", "memory")
  const sessions = path.join(memory, "sessions")
  mkdirSync(sessions, { recursive: true })
  writeFileSync(path.join(sessions, "old.md"), "old")
  writeFileSync(path.join(sessions, ".processed"), "old.md\n")
  writeFileSync(path.join(memory, "_index.md"), "[[build]] — build notes")

  const { ctx, getHook } = makeCtx(dir, work)
  const cleanup = await plugin.setup(ctx)

  expect(await waitFor(() => !existsSync(path.join(sessions, "old.md")))).toBe(true)

  const system = []
  await getHook()({ sessionID: "ses_1", system })
  expect(system).toHaveLength(1)
  expect(system[0].text).toContain("<project-memory")
  expect(system[0].text).toContain("[[build]]")

  await cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("does nothing when the project did not opt in", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-off-"))
  const { ctx } = makeCtx(dir, work)
  const cleanup = await plugin.setup(ctx)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(existsSync(path.join(dir, ".opencode"))).toBe(false)
  await cleanup()
  rmSync(dir, { recursive: true, force: true })
})

test("skips a dream session", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dream-skip-"))
  mkdirSync(path.join(dir, ".opencode", "memory"), { recursive: true })
  const messages = [{ id: "m1", type: "user", text: "<!-- opencode-dream:skip -->\nYou are the dream" }]
  const { ctx } = makeCtx(dir, messages)
  const cleanup = await plugin.setup(ctx)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(existsSync(path.join(dir, ".opencode", "memory", "sessions"))).toBe(false)
  await cleanup()
  rmSync(dir, { recursive: true, force: true })
})
