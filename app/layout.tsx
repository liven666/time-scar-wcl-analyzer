import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description =
    "在浏览器本地解析 WoWCombatLog.txt，按 Boss 与角色还原逐次施法、伤害、治疗、血量和 Buff 时间轴。";

  return {
    title: "时光战痕｜魔兽世界时光服 WCL 日志分析",
    description,
    keywords: ["魔兽世界", "时光服", "WCL", "战斗日志", "DPS分析"],
    openGraph: {
      title: "时光战痕｜时光服 WCL 分析台",
      description: "战斗结束，复盘才刚开始。原始日志不上传，逐次施法可追溯。",
      type: "website",
      locale: "zh_CN",
      url: origin,
      images: [
        {
          url: `${origin}/og-v2.png`,
          width: 1200,
          height: 630,
          alt: "时光战痕——战斗结束，复盘才刚开始。",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "时光战痕｜时光服 WCL 分析台",
      description: "战斗结束，复盘才刚开始。原始日志不上传，逐次施法可追溯。",
      images: [`${origin}/og-v2.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
