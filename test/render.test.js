import { test, expect } from "bun:test"
import { renderSession, isDreamSession, selectFresh, redact } from "../global/plugins/dream.ts"

const messages = [
  { id: "m1", type: "user", text: "run the tests", time: { created: 100 } },
  {
    id: "m2",
    type: "assistant",
    agent: "build",
    time: { created: 200 },
    content: [
      { type: "text", text: "Running." },
      {
        type: "tool",
        name: "shell",
        state: {
          status: "completed",
          input: { command: "bun test" },
          content: [{ type: "text", text: "3 pass" }],
        },
      },
    ],
  },
]

test("renders user text, tool call and tool result", () => {
  const out = renderSession(messages, { id: "ses_1", title: "t", directory: "D:/p" })
  expect(out).toContain("USER:")
  expect(out).toContain("TOOL CALL shell:")
  expect(out).toContain("TOOL RESULT (shell):")
  expect(out).toContain("3 pass")
})

test("marks a failed tool result", () => {
  const out = renderSession(
    [
      {
        id: "m1",
        type: "assistant",
        content: [{ type: "tool", name: "read", state: { status: "error", input: {}, content: [] } }],
      },
    ],
    { id: "ses_2" },
  )
  expect(out).toContain("TOOL RESULT (read) [error]:")
})

test("truncates a huge tool result", () => {
  const out = renderSession(
    [
      {
        id: "m1",
        type: "assistant",
        content: [
          {
            type: "tool",
            name: "shell",
            state: { status: "completed", input: {}, content: [{ type: "text", text: "x".repeat(9000) }] },
          },
        ],
      },
    ],
    { id: "ses_3" },
  )
  expect(out.length).toBeLessThan(6000)
  expect(out).toContain("chars truncated")
})

test("renders shell, synthetic and compaction", () => {
  const out = renderSession(
    [
      { id: "m1", type: "shell", command: "ls", output: { output: "a.txt" } },
      { id: "m2", type: "synthetic", text: "done" },
      { id: "m3", type: "compaction", summary: "short summary" },
    ],
    { id: "ses_4" },
  )
  expect(out).toContain("SHELL: ls")
  expect(out).toContain("a.txt")
  expect(out).toContain("SYSTEM:\ndone")
  expect(out).toContain("COMPACTION:\nshort summary")
})

test("redacts common credentials", () => {
  expect(redact("token=abcdefghijklmnop")).toContain("token=[redacted]")
  expect(redact("sk-test0000000000000000")).toBe("[redacted]")
  expect(redact("-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----")).toBe(
    "[redacted private key]",
  )
})

test("selects only messages after the last exported id", () => {
  expect(selectFresh(messages, { id: "m1" })).toHaveLength(1)
  expect(selectFresh(messages, { id: "m1" })[0].id).toBe("m2")
})

test("falls back to time when the last id is gone after compaction", () => {
  const fresh = selectFresh(messages, { id: "gone", at: 150 })
  expect(fresh).toHaveLength(1)
  expect(fresh[0].id).toBe("m2")
})

test("returns everything when there is no state", () => {
  expect(selectFresh(messages, undefined)).toHaveLength(2)
})

test("skips a session whose first message is the dream command", () => {
  expect(isDreamSession([{ type: "user", text: "<!-- opencode-dream:skip -->\nYou are the dream" }])).toBe(true)
  expect(isDreamSession([{ type: "user", text: "/dream" }])).toBe(true)
})

test("keeps a work session that runs /dream in the middle", () => {
  expect(
    isDreamSession([
      { type: "user", text: "fix login" },
      { type: "user", text: "<!-- opencode-dream:skip -->" },
    ]),
  ).toBe(false)
})
