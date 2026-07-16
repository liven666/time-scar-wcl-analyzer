# 战痕｜时光服 WCL 分析台

浏览器端本地解析 `WoWCombatLog.txt` 的团队日志分析工具。项目参考了
NGA 帖子“本地解析日志，30 秒生成可分享的 WCL 口径伤害统计”的产品思路。

## 当前能力

- 分块读取大体积战斗日志，原始文本不上传服务器
- 识别 Boss 场次、击杀状态、伤害目标、玩家和宠物归属
- 在“仅 Boss / 全日志 / 全局小怪”之间即时切换
- 调整单场权重，手动排除 Boss、失败场次和指定目标
- 计算自定义 DPS 合格线、近远程前三、DPS 不过坦和小怪尾位
- 统计破甲、精灵之火、恶魔契约覆盖率
- 识别开怪人和临时增伤光环
- 导出 CSV，并将汇总结果压缩进可分享链接

## 本地运行

需要 Node.js `>=22.13.0` 和 pnpm。

```bash
pnpm install
pnpm run dev
```

构建与测试：

```bash
pnpm run build
pnpm exec tsc --noEmit
node --test tests/rendered-html.test.mjs
```

## 口径说明

首版实现的是通用团队统计和可配置过滤，不承诺覆盖每个 Boss 的 WCL
专属规则。严谨排名、百分位和职业循环复盘仍应以 Warcraft Logs 为准。
