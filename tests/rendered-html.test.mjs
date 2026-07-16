import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the WCL analyzer shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>战痕｜魔兽世界时光服 WCL 日志分析<\/title>/i);
  assert.match(html, /时光服 WCL 分析台/);
  assert.match(html, /原始日志不上传/);
  assert.match(html, /伤害排行/);
  assert.match(html, /关键增益/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
