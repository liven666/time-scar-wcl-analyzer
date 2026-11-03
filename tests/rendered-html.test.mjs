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
  assert.match(html, /<title>时光战痕｜魔兽世界时光服 WCL 日志分析<\/title>/i);
  assert.match(html, /时光服 WCL 分析台/);
  assert.match(html, /原始日志不上传/);
  assert.match(html, /导入真实日志后显示分析报告/);
  assert.match(html, /演示数据已默认收起/);
  assert.match(html, /查看界面演示/);
  assert.match(html, /非真实数据/);
  assert.doesNotMatch(html, /class="report-section"/);
  assert.doesNotMatch(html, /战斗复盘时间轴|逐事件明细|玩家操作轴/);
  assert.match(html, /当前赛季进度/);
  assert.match(html, /当前进行中/);
  assert.match(html, /P6/);
  assert.match(html, /群星之巅/);
  assert.match(html, /奥杜尔/);
  assert.match(html, /当前为 P6 第 \d+ 周/);
  assert.match(html, /2026\.10\.08(?:<!-- -->)? 开始/);
  assert.match(html, /周数按北京时间自动计算/);
  assert.match(html, /预计还将持续|P7 时间预估/);
  assert.match(html, /约 \d+(?:—\d+)? 周|已进入预估窗口|等待官方公告/);
  assert.match(html, /12 月上旬—中旬/);
  assert.match(html, /官方确认 P7 将于 2026 年冬季开放/);
  assert.match(html, /卡拉赞（25人）· 格鲁尔的巢穴 · 玛瑟里顿的巢穴/);
  assert.match(html, /查看 P6 官方公告/);
  assert.doesNotMatch(html, /荆棘之路|十字军的试炼 · 祖尔格拉布|7 月 23 日—7 月 30 日/);
  assert.doesNotMatch(html, /时光服阶段副本表|纳克萨玛斯属于|已修正/);
  assert.match(html, /能处理真实日志，但不冒充完整 WCL/);
  assert.match(html, /href="https:\/\/github\.com\/liven666\/time-scar-wcl-analyzer"/);
  assert.match(html, /GitHub 源码/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
