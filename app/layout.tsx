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
    "在浏览器本地解析 WoWCombatLog.txt，生成伤害排行、Boss 口径、合格线、关键减益覆盖和开怪记录。";

  return {
    title: "时光战痕｜魔兽世界时光服 WCL 日志分析",
    description,
    keywords: ["魔兽世界", "时光服", "WCL", "战斗日志", "DPS分析"],
    openGraph: {
      title: "时光战痕｜时光服 WCL 分析台",
      description: "原始日志不上传，打完即看，按团规切换统计口径。",
      type: "website",
      locale: "zh_CN",
      url: origin,
    },
    twitter: {
      card: "summary",
      title: "时光战痕｜时光服 WCL 分析台",
      description: "原始日志不上传，打完即看，按团规切换统计口径。",
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
