"use client";

import {
  createDemoReport,
  parseCombatLogFile,
  type AuraMetric,
  type CombatReport,
  type CombatRole,
  type PlayerMeta,
  type WowClass,
} from "./lib/combat-log";
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ReportKind = "demo" | "local" | "shared";
type DamageView = "boss" | "full" | "trash";

interface RankedPlayer extends PlayerMeta {
  bossDamage: number;
  trashDamage: number;
  boostedDamage: number;
  totalDamage: number;
  dps: number;
  share: number;
  tags: Array<{ label: string; tone: string; title?: string }>;
}

const CLASS_COLORS: Record<WowClass, string> = {
  死亡骑士: "#c41e3a",
  德鲁伊: "#ff7c0a",
  猎人: "#aad372",
  法师: "#3fc7eb",
  圣骑士: "#f48cba",
  牧师: "#f4f3ef",
  潜行者: "#fff468",
  萨满祭司: "#4f8cff",
  术士: "#a58cff",
  战士: "#c69b6d",
  未知: "#9aa7a2",
};

const CLASS_SHORT: Record<WowClass, string> = {
  死亡骑士: "DK",
  德鲁伊: "德",
  猎人: "猎",
  法师: "法",
  圣骑士: "骑",
  牧师: "牧",
  潜行者: "贼",
  萨满祭司: "萨",
  术士: "术",
  战士: "战",
  未知: "?",
};

const ROLE_LABELS: Record<CombatRole, string> = {
  tank: "坦克",
  melee: "近战",
  ranged: "远程",
  unknown: "待识别",
};

const AURA_LABELS: Record<
  AuraMetric,
  { name: string; icon: string; target: number; note: string }
> = {
  armor: {
    name: "破甲类减益",
    icon: "破",
    target: 95,
    note: "破甲 / 揭底 / 酸液喷吐",
  },
  faerie: {
    name: "精灵之火",
    icon: "火",
    target: 90,
    note: "统计 Boss 有效覆盖时长",
  },
  demonic: {
    name: "恶魔契约",
    icon: "契",
    target: 92,
    note: "统计团队获得 Buff 的时长",
  },
};

const numberFormatter = new Intl.NumberFormat("zh-CN");
const compactFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function formatCompact(value: number): string {
  return compactFormatter.format(Math.max(0, value));
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}时${minutes}分`;
  if (minutes) return `${minutes}:${String(remainder).padStart(2, "0")}`;
  return `${remainder}秒`;
}

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function roleStyle(role: CombatRole): string {
  if (role === "tank") return "role-tank";
  if (role === "ranged") return "role-ranged";
  if (role === "melee") return "role-melee";
  return "role-unknown";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encodeReport(report: CombatReport): Promise<string> {
  const json = JSON.stringify(report);
  if (typeof CompressionStream === "undefined") {
    return `raw.${bytesToBase64(new TextEncoder().encode(json))}`;
  }
  const compressed = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  return `gz.${bytesToBase64(bytes)}`;
}

async function decodeReport(payload: string): Promise<CombatReport> {
  const [method, value] = payload.split(".", 2);
  const bytes = base64ToBytes(value);
  let json: string;
  if (method === "gz") {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器不支持读取压缩分享链接");
    }
    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);
    const decompressed = new Blob([copied.buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    json = await new Response(decompressed).text();
  } else {
    json = new TextDecoder().decode(bytes);
  }
  const report = JSON.parse(json) as CombatReport;
  if (report.version !== 1 || !Array.isArray(report.players)) {
    throw new Error("分享报告版本不受支持");
  }
  return report;
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export default function WclAnalyzer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<CombatReport>(() => createDemoReport());
  const [reportKind, setReportKind] = useState<ReportKind>("demo");
  const [activeFightIds, setActiveFightIds] = useState<Set<string>>(
    () => new Set(createDemoReport().fights.map((fight) => fight.id)),
  );
  const [fightWeights, setFightWeights] = useState<Record<string, number>>({});
  const [excludedTargets, setExcludedTargets] = useState<Set<string>>(new Set());
  const [view, setView] = useState<DamageView>("boss");
  const [thresholdRank, setThresholdRank] = useState(2);
  const [thresholdPercent, setThresholdPercent] = useState(60);
  const [excludeBoosted, setExcludeBoosted] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState("p-mage");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [ruleTargetsOpen, setRuleTargetsOpen] = useState(false);

  const activateReport = (nextReport: CombatReport, kind: ReportKind) => {
    setReport(nextReport);
    setReportKind(kind);
    setActiveFightIds(
      new Set(
        nextReport.fights
          .filter((fight) => fight.success || nextReport.fights.length === 1)
          .map((fight) => fight.id),
      ),
    );
    setFightWeights(
      Object.fromEntries(nextReport.fights.map((fight) => [fight.id, 100])),
    );
    setExcludedTargets(new Set());
    setSelectedPlayerId(nextReport.players[0]?.id ?? "");
    setView(nextReport.fights.length ? "boss" : "trash");
    setShowAll(false);
    setError("");
  };

  useEffect(() => {
    const payload = new URLSearchParams(window.location.hash.slice(1)).get("report");
    if (!payload) return;
    void decodeReport(payload)
      .then((sharedReport) => activateReport(sharedReport, "shared"))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "分享报告读取失败");
      });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedFights = useMemo(
    () => report.fights.filter((fight) => activeFightIds.has(fight.id)),
    [activeFightIds, report.fights],
  );

  const trashByActor = useMemo(() => {
    const values: Record<string, number> = {};
    for (const [actorId, targets] of Object.entries(report.trashActorTargets)) {
      values[actorId] = Object.entries(targets).reduce(
        (sum, [target, damage]) =>
          excludedTargets.has(target) ? sum : sum + damage,
        0,
      );
    }
    return values;
  }, [excludedTargets, report.trashActorTargets]);

  const rankedPlayers = useMemo<RankedPlayer[]>(() => {
    const raw = report.players.map((player) => {
      let bossDamage = 0;
      let boostedDamage = 0;
      for (const fight of selectedFights) {
        const weight = (fightWeights[fight.id] ?? 100) / 100;
        const targets = fight.actorTargets[player.id] ?? {};
        bossDamage +=
          Object.entries(targets).reduce(
            (sum, [target, damage]) =>
              excludedTargets.has(target) ? sum : sum + damage,
            0,
          ) * weight;
        boostedDamage += (fight.boostedByActor[player.id] ?? 0) * weight;
      }
      if (excludeBoosted) bossDamage = Math.max(0, bossDamage - boostedDamage);
      const trashDamage = trashByActor[player.id] ?? 0;
      const totalDamage =
        view === "boss"
          ? bossDamage
          : view === "trash"
            ? trashDamage
            : bossDamage + trashDamage;
      const bossDuration = selectedFights.reduce(
        (sum, fight) =>
          sum + fight.durationMs * ((fightWeights[fight.id] ?? 100) / 100),
        0,
      );
      const duration =
        view === "boss"
          ? bossDuration
          : view === "trash"
            ? report.trashDurationMs
            : bossDuration + report.trashDurationMs;
      return {
        ...player,
        bossDamage,
        trashDamage,
        boostedDamage,
        totalDamage,
        dps: duration ? totalDamage / (duration / 1000) : 0,
        share: 0,
        tags: [],
      };
    });

    raw.sort((a, b) => b.totalDamage - a.totalDamage);
    const totalRaidDamage = raw.reduce((sum, player) => sum + player.totalDamage, 0);
    const damageDealers = raw.filter((player) => player.role !== "tank");
    const baseline =
      damageDealers[Math.min(thresholdRank - 1, damageDealers.length - 1)]
        ?.totalDamage ?? 0;
    const threshold = baseline * (thresholdPercent / 100);
    const maxTankDamage = Math.max(
      0,
      ...raw.filter((player) => player.role === "tank").map((player) => player.totalDamage),
    );

    const positionMap = new Map<string, { kind: "近" | "远"; position: number }>();
    (["melee", "ranged"] as const).forEach((role) => {
      raw
        .filter((player) => player.role === role)
        .slice(0, 3)
        .forEach((player, index) => {
          positionMap.set(player.id, {
            kind: role === "melee" ? "近" : "远",
            position: index + 1,
          });
        });
    });

    const tailMap = new Map<string, number>();
    [...damageDealers]
      .sort((a, b) => a.trashDamage - b.trashDamage)
      .slice(0, 5)
      .forEach((player, index) => tailMap.set(player.id, index + 1));

    return raw.map((player) => {
      const tags: RankedPlayer["tags"] = [];
      const position = positionMap.get(player.id);
      if (position) {
        tags.push({
          label: `${position.kind}${position.position}`,
          tone: position.kind === "近" ? "orange" : "blue",
          title: `${position.kind === "近" ? "近战" : "远程"}伤害第 ${position.position} 名`,
        });
      }
      if (
        player.role !== "tank" &&
        baseline > 0 &&
        player.totalDamage < threshold
      ) {
        tags.push({
          label: "不合格",
          tone: "red",
          title: `低于第 ${thresholdRank} 名的 ${thresholdPercent}%`,
        });
      }
      if (
        player.role !== "tank" &&
        maxTankDamage > 0 &&
        player.totalDamage <= maxTankDamage
      ) {
        tags.push({
          label: "不过T",
          tone: "slate",
          title: "当前口径伤害未超过最高坦克",
        });
      }
      const tail = tailMap.get(player.id);
      if (tail) {
        tags.push({
          label: `尾${tail}`,
          tone: "violet",
          title: `全局小怪伤害倒数第 ${tail} 名（已过滤坦克）`,
        });
      }
      if (player.boostedDamage > 0) {
        tags.push({
          label: excludeBoosted ? "增伤已剔除" : "临时增伤",
          tone: "gold",
          title: `识别到 ${formatCompact(player.boostedDamage)} 临时增伤伤害`,
        });
      }
      return {
        ...player,
        share: totalRaidDamage ? player.totalDamage / totalRaidDamage : 0,
        tags,
      };
    });
  }, [
    excludeBoosted,
    excludedTargets,
    fightWeights,
    report.players,
    report.trashDurationMs,
    selectedFights,
    thresholdPercent,
    thresholdRank,
    trashByActor,
    view,
  ]);

  const selectedPlayer =
    rankedPlayers.find((player) => player.id === selectedPlayerId) ??
    rankedPlayers[0];

  const selectedDuration = useMemo(
    () =>
      selectedFights.reduce(
        (sum, fight) =>
          sum + fight.durationMs * ((fightWeights[fight.id] ?? 100) / 100),
        0,
      ),
    [fightWeights, selectedFights],
  );

  const auraCoverage = useMemo(() => {
    const result: Record<AuraMetric, number> = {
      armor: 0,
      faerie: 0,
      demonic: 0,
    };
    const duration = selectedFights.reduce(
      (sum, fight) =>
        sum + fight.durationMs * ((fightWeights[fight.id] ?? 100) / 100),
      0,
    );
    if (!duration) return result;
    (Object.keys(result) as AuraMetric[]).forEach((metric) => {
      const covered = selectedFights.reduce(
        (sum, fight) =>
          sum + fight.auraMs[metric] * ((fightWeights[fight.id] ?? 100) / 100),
        0,
      );
      result[metric] = Math.min(100, (covered / duration) * 100);
    });
    return result;
  }, [fightWeights, selectedFights]);

  const targetTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const fight of selectedFights) {
      const weight = (fightWeights[fight.id] ?? 100) / 100;
      for (const [target, damage] of Object.entries(fight.targets)) {
        totals[target] = (totals[target] ?? 0) + damage * weight;
      }
    }
    if (view !== "boss") {
      for (const [target, damage] of Object.entries(report.trashTargets)) {
        totals[target] = (totals[target] ?? 0) + damage;
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [fightWeights, report.trashTargets, selectedFights, view]);

  const maxDamage = rankedPlayers[0]?.totalDamage || 1;
  const visiblePlayers = showAll ? rankedPlayers : rankedPlayers.slice(0, 10);
  const killCount = selectedFights.filter((fight) => fight.success).length;
  const invalidCount = rankedPlayers.filter((player) =>
    player.tags.some((tag) => tag.label === "不合格"),
  ).length;
  const underTankCount = rankedPlayers.filter((player) =>
    player.tags.some((tag) => tag.label === "不过T"),
  ).length;
  const excludedTargetDamage = targetTotals.reduce(
    (sum, [target, damage]) => (excludedTargets.has(target) ? sum + damage : sum),
    0,
  );

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    setProcessing(true);
    setProgress(2);
    setProgressMessage("正在读取日志文件");
    setError("");
    setLastFile(file);
    try {
      const parsed = await parseCombatLogFile(
        file,
        {
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          mergePets: true,
        },
        (nextProgress, message) => {
          setProgress(nextProgress);
          setProgressMessage(message);
        },
      );
      activateReport(parsed, "local");
      setToast(`解析完成：识别 ${parsed.players.length} 名玩家`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "日志解析失败");
    } finally {
      setProcessing(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const resetDemo = () => {
    activateReport(createDemoReport(), "demo");
    setLastFile(null);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setToast("已切换到演示报告");
  };

  const shareReport = async () => {
    try {
      setToast("正在生成分享链接…");
      const payload = await encodeReport(report);
      const url = new URL(window.location.href);
      url.hash = new URLSearchParams({ report: payload }).toString();
      await copyText(url.toString());
      window.history.replaceState(null, "", url.toString());
      setToast("分享链接已复制，仅包含汇总结果");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分享链接生成失败");
    }
  };

  const exportCsv = () => {
    const rows = [
      ["排名", "角色", "职业", "职责", "Boss伤害", "小怪伤害", "当前口径伤害", "DPS", "占比", "标记"],
      ...rankedPlayers.map((player, index) => [
        index + 1,
        player.name,
        player.className,
        ROLE_LABELS[player.role],
        Math.round(player.bossDamage),
        Math.round(player.trashDamage),
        Math.round(player.totalDamage),
        Math.round(player.dps),
        `${(player.share * 100).toFixed(2)}%`,
        player.tags.map((tag) => tag.label).join(" "),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `${report.raidName.replace(/[\\/:*?"<>|]/g, "-")}-伤害统计.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setToast("CSV 已导出");
  };

  const toggleFight = (fightId: string) => {
    setActiveFightIds((current) => {
      const next = new Set(current);
      if (next.has(fightId)) next.delete(fightId);
      else next.add(fightId);
      return next;
    });
  };

  const toggleTarget = (target: string) => {
    setExcludedTargets((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  };

  const reportKindLabel =
    reportKind === "demo"
      ? "演示数据"
      : reportKind === "shared"
        ? "分享报告"
        : "本地日志";

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span className="brand-mark" aria-hidden="true">
            <span>战</span>
          </span>
          <span className="brand-copy">
            <strong>战痕</strong>
            <small>时光服 WCL 分析台</small>
          </span>
        </a>
        <nav className="top-nav" aria-label="主要导航">
          <a href="#report">报告</a>
          <a href="#rules">统计规则</a>
          <a href="#guide">方法说明</a>
        </nav>
        <div className="header-actions">
          <span className="local-pill">
            <span className="status-dot" />
            原始日志不上传
          </span>
          <button className="button button-primary button-compact" type="button" onClick={openFilePicker}>
            选择日志
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-line" />
              TITAN REFORGED · RAID REVIEW
            </span>
            <h1>
              打完就看，
              <br />
              <span>别让 WCL 排队耽误分 G。</span>
            </h1>
            <p>
              在浏览器本地解析 <strong>WoWCombatLog.txt</strong>，按接近 WCL
              的团队考核口径生成伤害排行、合格线、关键减益覆盖与开怪记录。原始日志不会离开你的设备。
            </p>
            <div className="hero-points" aria-label="产品特点">
              <span><b>10–30 秒</b>典型日志</span>
              <span><b>0 B</b>原始日志上传</span>
              <span><b>1 个链接</b>分享汇总</span>
            </div>
            <div className="hero-actions">
              <button className="button button-primary" type="button" onClick={openFilePicker}>
                <span aria-hidden="true">＋</span>
                选择 WoWCombatLog.txt
              </button>
              <button className="button button-ghost" type="button" onClick={resetDemo}>
                查看演示报告
              </button>
            </div>
          </div>

          <div className="upload-column">
            <div
              className={`upload-card ${dragging ? "is-dragging" : ""} ${processing ? "is-processing" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".txt,.log,text/plain"
                onChange={onFileChange}
              />
              <div className="upload-crest" aria-hidden="true">
                <span>LOG</span>
              </div>
              {processing ? (
                <>
                  <span className="upload-kicker">正在本地处理</span>
                  <h2>{progressMessage}</h2>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <p>{progress}% · 页面保持打开即可</p>
                </>
              ) : (
                <>
                  <span className="upload-kicker">拖入即分析</span>
                  <h2>把战斗日志放到这里</h2>
                  <p>支持高级战斗日志；数百 MB 文件会分块读取，不占用服务器带宽。</p>
                  <button className="text-button" type="button" onClick={openFilePicker}>
                    或点击选择文件 <span>→</span>
                  </button>
                </>
              )}
              <div className="time-filter">
                <label>
                  <span>开始时间</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    disabled={processing}
                  />
                </label>
                <span className="time-divider">—</span>
                <label>
                  <span>结束时间</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    disabled={processing}
                  />
                </label>
              </div>
              <p className="upload-footnote">串日志时可先限定开团时间；留空则解析全部内容。</p>
            </div>
            <div className="privacy-note">
              <span className="privacy-icon" aria-hidden="true">⌁</span>
              <p>
                <strong>隐私说明</strong>
                只读取战斗事件；分享链接不包含原始文本、聊天或账号信息。
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="error-banner" role="alert">
            <span>!</span>
            <p>{error}</p>
            <button type="button" onClick={() => setError("")}>关闭</button>
          </div>
        ) : null}

        <section className="report-section" id="report">
          <div className="report-heading">
            <div>
              <div className="section-label">
                <span>{reportKindLabel}</span>
                <span>解析器 v{report.parserVersion}</span>
              </div>
              <h2>{report.raidName}</h2>
              <p>
                {report.sourceName} · {formatBytes(report.sourceSize)} · {report.timeWindow}
              </p>
            </div>
            <div className="report-actions">
              {lastFile ? (
                <button
                  className="button button-ghost button-compact"
                  type="button"
                  onClick={() => void handleFile(lastFile)}
                  disabled={processing}
                >
                  重新解析
                </button>
              ) : null}
              <button className="button button-ghost button-compact" type="button" onClick={exportCsv}>
                导出 CSV
              </button>
              <button className="button button-gold button-compact" type="button" onClick={() => void shareReport()}>
                生成分享链接
              </button>
            </div>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-icon">行</span>
              <div>
                <small>解析行数</small>
                <strong>{formatCompact(report.totalLines)}</strong>
              </div>
              <em>{formatNumber(report.validEvents)} 条有效事件</em>
            </article>
            <article className="metric-card">
              <span className="metric-icon">首</span>
              <div>
                <small>Boss 击杀</small>
                <strong>{killCount}</strong>
              </div>
              <em>{selectedFights.length} 场纳入口径</em>
            </article>
            <article className="metric-card">
              <span className="metric-icon">队</span>
              <div>
                <small>识别成员</small>
                <strong>{report.players.length}</strong>
              </div>
              <em>宠物伤害自动归属</em>
            </article>
            <article className="metric-card">
              <span className="metric-icon">时</span>
              <div>
                <small>Boss 战时长</small>
                <strong>{formatDuration(selectedDuration)}</strong>
              </div>
              <em>生成于 {formatGeneratedAt(report.generatedAt)}</em>
            </article>
          </div>

          <div className="conclusion-banner">
            <span className="conclusion-mark" aria-hidden="true">团</span>
            <p>
              <strong>团长速读：</strong>
              破甲覆盖 <b>{auraCoverage.armor.toFixed(1)}%</b>，精灵之火覆盖{" "}
              <b>{auraCoverage.faerie.toFixed(1)}%</b>；当前合格线下{" "}
              <b>{invalidCount}</b> 人，DPS 不过坦 <b>{underTankCount}</b> 人。
              {excludedTargetDamage > 0
                ? ` 已剔除 ${formatCompact(excludedTargetDamage)} 目标伤害。`
                : " 尚未手动剔除目标伤害。"}
            </p>
            <span className={`conclusion-state ${invalidCount ? "warn" : "good"}`}>
              {invalidCount ? "建议复盘" : "状态良好"}
            </span>
          </div>

          <div className="dashboard-grid">
            <section className="panel ranking-panel">
              <div className="panel-header ranking-header">
                <div>
                  <span className="panel-kicker">DAMAGE REVIEW</span>
                  <h3>伤害排行</h3>
                </div>
                <div className="ranking-controls">
                  <div className="segmented" aria-label="统计视图">
                    <button
                      className={view === "boss" ? "active" : ""}
                      type="button"
                      onClick={() => setView("boss")}
                    >
                      仅 Boss
                    </button>
                    <button
                      className={view === "full" ? "active" : ""}
                      type="button"
                      onClick={() => setView("full")}
                    >
                      全日志
                    </button>
                    <button
                      className={view === "trash" ? "active" : ""}
                      type="button"
                      onClick={() => setView("trash")}
                    >
                      全局小怪
                    </button>
                  </div>
                  <div className="threshold-control">
                    <span>合格：第</span>
                    <select
                      value={thresholdRank}
                      onChange={(event) => setThresholdRank(Number(event.target.value))}
                      aria-label="合格线基准排名"
                    >
                      {[1, 2, 3, 4, 5].map((rank) => (
                        <option value={rank} key={rank}>{rank}</option>
                      ))}
                    </select>
                    <span>名的</span>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      value={thresholdPercent}
                      onChange={(event) =>
                        setThresholdPercent(
                          Math.min(100, Math.max(10, Number(event.target.value) || 10)),
                        )
                      }
                      aria-label="合格线百分比"
                    />
                    <span>%</span>
                  </div>
                </div>
              </div>

              <div className="ranking-table" role="table" aria-label="团队伤害排名">
                <div className="ranking-table-head" role="row">
                  <span role="columnheader">排名 / 角色</span>
                  <span role="columnheader">团队标记</span>
                  <span role="columnheader">Boss 伤害</span>
                  <span role="columnheader">小怪伤害</span>
                  <span role="columnheader">DPS</span>
                  <span role="columnheader">占比</span>
                </div>
                <div className="ranking-table-body">
                  {visiblePlayers.map((player, index) => {
                    const classColor = CLASS_COLORS[player.className];
                    const style = {
                      "--class-color": classColor,
                      "--damage-width": `${Math.max(2, (player.totalDamage / maxDamage) * 100)}%`,
                    } as CSSProperties;
                    return (
                      <button
                        className={`ranking-row ${selectedPlayer?.id === player.id ? "selected" : ""}`}
                        style={style}
                        type="button"
                        role="row"
                        key={player.id}
                        onClick={() => setSelectedPlayerId(player.id)}
                      >
                        <span className="damage-bar" aria-hidden="true" />
                        <span className="player-cell" role="cell">
                          <b className={`rank-number rank-${index + 1}`}>{index + 1}</b>
                          <span className="class-token">{CLASS_SHORT[player.className]}</span>
                          <span className="player-copy">
                            <strong>{player.name}</strong>
                            <small>
                              {player.className} ·{" "}
                              <span className={roleStyle(player.role)}>
                                {ROLE_LABELS[player.role]}
                              </span>
                            </small>
                          </span>
                        </span>
                        <span className="tag-cell" role="cell">
                          {player.tags.length ? (
                            player.tags.slice(0, 3).map((tag) => (
                              <span
                                className={`data-tag ${tag.tone}`}
                                title={tag.title}
                                key={`${player.id}-${tag.label}`}
                              >
                                {tag.label}
                              </span>
                            ))
                          ) : (
                            <span className="clean-tag">正常</span>
                          )}
                        </span>
                        <span className="number-cell" role="cell">
                          <strong>{formatCompact(player.bossDamage)}</strong>
                          <small>{formatNumber(player.bossDamage)}</small>
                        </span>
                        <span className="number-cell" role="cell">
                          <strong>{formatCompact(player.trashDamage)}</strong>
                          <small>{formatNumber(player.trashDamage)}</small>
                        </span>
                        <span className="number-cell" role="cell">
                          <strong>{formatNumber(player.dps)}</strong>
                          <small>每秒</small>
                        </span>
                        <span className="share-cell" role="cell">
                          <strong>{(player.share * 100).toFixed(1)}%</strong>
                          <span className="share-ring" style={{ "--share": `${player.share * 360}deg` } as CSSProperties} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="ranking-footer">
                <button className="show-all-button" type="button" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "收起名单" : `显示全部 ${rankedPlayers.length} 人`}
                  <span aria-hidden="true">{showAll ? "↑" : "↓"}</span>
                </button>
                <span>点击角色查看技能构成与伤害归属</span>
              </div>

              {selectedPlayer ? (
                <div className="player-detail">
                  <div className="player-detail-heading">
                    <span
                      className="detail-class-token"
                      style={{ background: CLASS_COLORS[selectedPlayer.className] }}
                    >
                      {CLASS_SHORT[selectedPlayer.className]}
                    </span>
                    <div>
                      <small>当前选中</small>
                      <h4>{selectedPlayer.name}</h4>
                    </div>
                    <span className="detail-total">
                      <small>当前口径</small>
                      <strong>{formatNumber(selectedPlayer.totalDamage)}</strong>
                    </span>
                  </div>
                  <div className="spell-list">
                    {selectedPlayer.topSpells.map((spell, index) => {
                      const topValue = selectedPlayer.topSpells[0]?.damage || 1;
                      return (
                        <div className="spell-row" key={spell.name}>
                          <span>{index + 1}</span>
                          <strong>{spell.name}</strong>
                          <div><i style={{ width: `${(spell.damage / topValue) * 100}%` }} /></div>
                          <b>{formatCompact(spell.damage)}</b>
                        </div>
                      );
                    })}
                  </div>
                  <div className="detail-stats">
                    <span>承伤 <b>{formatCompact(selectedPlayer.damageTaken)}</b></span>
                    <span>宠物贡献 <b>{formatCompact(selectedPlayer.petDamage)}</b></span>
                    <span>临时增伤 <b>{formatCompact(selectedPlayer.boostedDamage)}</b></span>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="panel rules-panel" id="rules">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">WCL-LIKE RULES</span>
                  <h3>Boss 战斗场次</h3>
                </div>
                <span className="rule-count">{activeFightIds.size}/{report.fights.length}</span>
              </div>

              <div className="rule-preset">
                <div>
                  <span className="preset-icon">W</span>
                  <p><strong>时光服通用口径</strong><small>仅击杀 · 宠物归属 · 增伤剔除</small></p>
                </div>
                <span>已启用</span>
              </div>

              <label className="switch-row">
                <span>
                  <strong>剔除临时增伤伤害</strong>
                  <small>双子精华、邪恶狂热等已识别光环</small>
                </span>
                <input
                  type="checkbox"
                  checked={excludeBoosted}
                  onChange={(event) => setExcludeBoosted(event.target.checked)}
                />
                <i />
              </label>

              <div className="fight-list">
                {report.fights.length ? (
                  report.fights.map((fight, index) => {
                    const active = activeFightIds.has(fight.id);
                    const totalDamage = Object.values(fight.targets).reduce(
                      (sum, damage) => sum + damage,
                      0,
                    );
                    return (
                      <article className={`fight-card ${active ? "active" : "disabled"}`} key={fight.id}>
                        <div className="fight-topline">
                          <button
                            className="fight-check"
                            type="button"
                            aria-label={`${active ? "排除" : "纳入"} ${fight.name}`}
                            onClick={() => toggleFight(fight.id)}
                          >
                            {active ? "✓" : ""}
                          </button>
                          <div>
                            <small>Boss战 {index + 1}</small>
                            <h4>{fight.name}</h4>
                          </div>
                          <span className={`kill-badge ${fight.success ? "" : "wipe"}`}>
                            {fight.success ? "击杀" : "失败"}
                          </span>
                        </div>
                        <div className="fight-meta">
                          <span>{fight.startLabel}</span>
                          <span>{formatDuration(fight.durationMs)}</span>
                          <span>{formatCompact(totalDamage)}</span>
                        </div>
                        <div className="puller-line" title={fight.pullMethod}>
                          <span>开怪</span>
                          <strong>{fight.puller}</strong>
                          <small>{fight.pullMethod}</small>
                        </div>
                        <label className="weight-control">
                          <span>伤害比例</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={fightWeights[fight.id] ?? 100}
                            onChange={(event) =>
                              setFightWeights((current) => ({
                                ...current,
                                [fight.id]: Math.min(
                                  100,
                                  Math.max(0, Number(event.target.value) || 0),
                                ),
                              }))
                            }
                            disabled={!active}
                          />
                          <b>%</b>
                        </label>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-rules">
                    <span>?</span>
                    <p>日志里没有识别到 Boss 场次，可切换到“全局小怪”查看。</p>
                  </div>
                )}
              </div>

              <div className="target-rules">
                <button type="button" onClick={() => setRuleTargetsOpen((value) => !value)}>
                  <span>
                    <strong>目标剔除</strong>
                    <small>{excludedTargets.size} 个目标已排除</small>
                  </span>
                  <b>{ruleTargetsOpen ? "−" : "+"}</b>
                </button>
                {ruleTargetsOpen ? (
                  <div className="target-list">
                    {targetTotals.map(([target, damage]) => {
                      const excluded = excludedTargets.has(target);
                      return (
                        <label className={excluded ? "excluded" : ""} key={target}>
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() => toggleTarget(target)}
                          />
                          <span><strong>{target}</strong><small>{formatCompact(damage)}</small></span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </aside>
          </div>

          <div className="review-grid">
            <section className="panel aura-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">RAID DEBUFFS</span>
                  <h3>关键增益 / 减益</h3>
                </div>
                <span className="panel-note">按纳入口径加权</span>
              </div>
              <div className="aura-grid">
                {(Object.keys(AURA_LABELS) as AuraMetric[]).map((metric) => {
                  const config = AURA_LABELS[metric];
                  const coverage = auraCoverage[metric];
                  const healthy = coverage >= config.target;
                  return (
                    <article className="aura-card" key={metric}>
                      <span className={`aura-icon aura-${metric}`}>{config.icon}</span>
                      <div className="aura-copy">
                        <small>{config.name}</small>
                        <strong>{coverage.toFixed(1)}%</strong>
                        <p>{config.note}</p>
                      </div>
                      <div className="aura-meter">
                        <span style={{ height: `${coverage}%` }} />
                      </div>
                      <em className={healthy ? "healthy" : "attention"}>
                        {healthy ? "达标" : `目标 ${config.target}%`}
                      </em>
                    </article>
                  );
                })}
                <article className="aura-card scene-card">
                  <span className="aura-icon aura-scene">场</span>
                  <div className="aura-copy">
                    <small>战斗场次</small>
                    <strong>{selectedFights.length}</strong>
                    <p>{report.fights.length - selectedFights.length} 场被排除</p>
                  </div>
                  <div className="scene-dots">
                    {report.fights.slice(0, 8).map((fight) => (
                      <i
                        className={activeFightIds.has(fight.id) ? "on" : ""}
                        key={fight.id}
                      />
                    ))}
                  </div>
                  <em className="healthy">实时刷新</em>
                </article>
              </div>
            </section>

            <section className="panel puller-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">PULL AUDIT</span>
                  <h3>开怪记录</h3>
                </div>
                <span className="panel-note">取首个有效伤害 / 承伤</span>
              </div>
              <div className="puller-list">
                {selectedFights.slice(0, 6).map((fight, index) => (
                  <div className="puller-row" key={fight.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{fight.name}</strong>
                      <small>{fight.startLabel} · {formatDuration(fight.durationMs)}</small>
                    </div>
                    <p>
                      <b>{fight.puller}</b>
                      <small>{fight.pullMethod}</small>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {report.warnings.length ? (
            <div className="warning-strip">
              <span>!</span>
              <div>
                <strong>解析提示</strong>
                <p>{report.warnings.join(" · ")}</p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="guide-section" id="guide">
          <div className="guide-heading">
            <span className="eyebrow">
              <span className="eyebrow-line" />
              HOW IT WORKS
            </span>
            <h2>一份日志，三步给出能行动的结论。</h2>
            <p>首版先解决大众团最耗时间的统计与筛选；严谨排名、百分位和职业循环仍以 WCL 为准。</p>
          </div>
          <div className="guide-cards">
            <article>
              <span>01</span>
              <h3>本地解析</h3>
              <p>分块读取战斗事件，识别 Boss 场次、玩家、宠物归属、伤害目标和关键光环。</p>
              <b>原始日志不出浏览器</b>
            </article>
            <article>
              <span>02</span>
              <h3>按团规切口径</h3>
              <p>秒切仅 Boss、全日志或小怪；可排除场次、目标和临时增伤，并调整单场权重。</p>
              <b>不用重新上传</b>
            </article>
            <article>
              <span>03</span>
              <h3>分享汇总</h3>
              <p>把解析后的统计结果压缩进链接，队友打开即可看到相同页面和相同筛选规则。</p>
              <b>不包含聊天与账号信息</b>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true"><span>战</span></span>
          <span className="brand-copy"><strong>战痕</strong><small>Raid logs, made readable.</small></span>
        </div>
        <p>
          社区非官方工具原型，与 Blizzard Entertainment、Warcraft Logs
          无隶属关系。最终结算请以团队规则和 WCL 官方数据为准。
        </p>
        <a href="https://bbs.nga.cn/read.php?tid=46923197" target="_blank" rel="noreferrer">
          灵感来源：NGA 原帖
        </a>
      </footer>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
