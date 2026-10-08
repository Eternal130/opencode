import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const base = {
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const parent = { ...base, id: "ses_parent", title: "Parent session" }
const child = { ...base, id: "ses_child", title: "Child subagent", parentID: parent.id }
const sessions = { [parent.id]: parent, [child.id]: child }

const blockedParent = {
  id: "msg_parent",
  type: "assistant",
  agent: "build",
  model: base.model,
  time: { created: 0 },
  content: [
    {
      type: "tool",
      id: "call_subagent",
      name: "subagent",
      state: {
        status: "running",
        input: { description: "Child subagent" },
        metadata: { sessionID: child.id, status: "running" },
      },
      time: { created: 0, ran: 0 },
    },
  ],
}

test("ctrl+b in a subagent view backgrounds the parent's blocking work", async () => {
  await using state = await tmpdir()
  const backgrounded: string[] = []
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: child.id },
    config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
    fetch: (url, request) => {
      const background = url.pathname.match(/^\/api\/session\/([^/]+)\/background$/)?.[1]
      if (background && request.method === "POST") {
        backgrounded.push(background)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [parent, child], cursor: {} })
      const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
      if (sessionID && sessionID in sessions) return json({ data: sessions[sessionID] })
      if (url.pathname === `/api/session/${parent.id}/message`) return json({ data: [blockedParent], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })

  await setup.waitForFrame((frame) => frame.includes("to move running work to the background"))
  setup.mockInput.pressKey("b", { ctrl: true })
  for (let attempt = 0; attempt < 50 && backgrounded.length === 0; attempt++) await Bun.sleep(10)

  expect(backgrounded).toEqual([parent.id])
})
