# 时光战痕部署说明

## 运行要求

- Node.js `>= 22.13.0`
- pnpm `11.9.0`（可通过 Corepack 自动启用）
- 构建机器至少预留 1 GB 内存
- 不需要数据库、对象存储或环境密钥

安装并验证：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

## 推荐：通用 Node.js 平台

适用于 Railway、Render、Fly.io、VPS、Docker 容器等能够常驻 Node.js
进程的平台。

构建命令：

```bash
pnpm install --frozen-lockfile
pnpm run build
```

启动命令：

```bash
pnpm run start
```

程序会读取平台提供的 `PORT` 环境变量，默认监听 `0.0.0.0:3000`。健康检查路径可设为
`/`。生产构建输出位于 `dist/`，不要只上传 `dist/client/`，因为页面包含 SSR 和
`/api/spell-icon` 服务端路由。

## Cloudflare Workers

项目已经包含 Worker 入口和 Cloudflare Vite 配置。

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

首次部署前需要先执行 `pnpm exec wrangler login`。如果要修改 Worker 名称，可调整
`package.json` 中的 `name`，重新构建后再部署。

## 平台兼容性

- 纯静态托管（仅 HTML/CSS/JS 的对象存储、GitHub Pages）不适用，因为项目包含 SSR
  和技能图标代理接口。
- Vercel/Netlify 的原生 Next.js 适配器没有在本项目中验证。建议优先选择通用 Node.js
  服务或 Cloudflare Workers；若要切换适配器，需要重新验证 Web Worker、API 路由和
  大文件解析。
- 服务端需要允许访问 `https://nether.wowhead.com`、`https://wow.zamimg.com` 和
  `https://warcraft.wiki.gg` 才能补全未内置的技能图标。访问失败时页面仍会显示文字
  备用图标，不影响日志解析。

## 日志与实时解析边界

- 普通“选择日志文件”始终在浏览器内解析，原始战斗日志不会上传到部署服务器。
- 部署到 HTTPS 后，Chrome/Edge 可使用浏览器原生文件授权持续读取仍在写入的日志。
- `scripts/live-log-server.mjs` 提供的 `127.0.0.1:3001` 路径助手只用于本机开发，远程
  网站不能直接读取服务器或玩家电脑上的任意绝对路径。
- 如部署平台设置了请求体限制，不会影响日志导入，因为原始日志不会作为 HTTP 请求
  上传。

## 发布前检查

```bash
pnpm run lint
pnpm test
```

浏览器至少检查一次：导入真实高级日志、切换深浅模式、缩放/拖动时间轴、悬停与点击
技能图标，以及技能图标接口是否能返回图片。
