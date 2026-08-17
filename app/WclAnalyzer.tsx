"use client";

import {
  createDemoReport,
  type AuraMetric,
  type CombatReport,
  type CombatRole,
  type ParseOptions,
  type PlayerMeta,
  type WowClass,
} from "./lib/combat-log";
import {
  createCombatLogWorker,
  parseCombatLogFileInWorker,
  type CombatLogWorkerResponse,
} from "./lib/combat-log-client";
import { getPhaseProgress } from "./lib/phase-progress";
import CombatReplay from "./CombatReplay";
import PlayerComparison from "./PlayerComparison";
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
type ThemeMode = "dark" | "light";
type LiveLogStatus = "idle" | "starting" | "watching";

interface LocalFileHandle {
  name: string;
  getFile: () => Promise<File>;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<LocalFileHandle[]>;
}

interface LiveLogSource {
  name: string;
  getInitialFile: () => Promise<File>;
  readGrowth: (offset: number) => Promise<{
    size: number;
    chunk?: ArrayBuffer;
    rotated: boolean;
  }>;
}

const LIVE_HELPER_ROOT = "http://127.0.0.1:3001";

async function localHelperError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return new Error(payload.error);
  } catch {
    // Fall through to the HTTP status when the helper returned plain text.
  }
  return new Error(`本地实时助手返回 ${response.status}`);
}

function fileHandleLiveSource(handle: LocalFileHandle): LiveLogSource {
  return {
    name: handle.name,
    getInitialFile: () => handle.getFile(),
    readGrowth: async (offset) => {
      const file = await handle.getFile();
      if (file.size < offset) {
        return { size: file.size, rotated: true };
      }
      return {
        size: file.size,
        rotated: false,
        chunk:
          file.size > offset
            ? await file.slice(offset).arrayBuffer()
            : undefined,
      };
    },
  };
}

function localPathLiveSource(path: string): LiveLogSource {
  const normalizedPath = path.trim();
  const query = encodeURIComponent(normalizedPath);
  return {
    name: normalizedPath.split(/[\\/]/).at(-1) || "WoWCombatLog.txt",
    getInitialFile: async () => {
      const response = await fetch(`${LIVE_HELPER_ROOT}/file?path=${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw await localHelperError(response);
      const encodedName = response.headers.get("X-File-Name");
      const name = encodedName
        ? decodeURIComponent(encodedName)
        : normalizedPath.split(/[\\/]/).at(-1) || "WoWCombatLog.txt";
      return new File([await response.blob()], name, { type: "text/plain" });
    },
    readGrowth: async (offset) => {
      const response = await fetch(
        `${LIVE_HELPER_ROOT}/range?path=${query}&offset=${offset}`,
        { cache: "no-store" },
      );
      if (!response.ok && response.status !== 204) {
        throw await localHelperError(response);
      }
      const size = Number(response.headers.get("X-File-Size")) || 0;
      const rotated = response.headers.get("X-Log-Rotated") === "1";
      return {
        size,
        rotated,
        chunk:
          response.status === 204 ? undefined : await response.arrayBuffer(),
      };
    },
  };
}

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
  healer: "治疗",
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
    note: "统计团队内 Buff 存在时长",
  },
};

const TITAN_PHASE_STATUS = {
  phase: "P5",
  season: "晨星破晓",
  raids: "祖阿曼 · 太阳之井高地",
  startedAt: "2026-08-06",
  startedDisplay: "2026.08.06",
  startedLabel: "8.06 开始",
  nextPhase: "P6",
  nextWindow: "10 月上旬—中旬",
  forecastStartAt: "2026-10-01",
  forecastEndAt: "2026-10-15",
  forecastWeekRange: "第 9 至第 10 周",
  timelineWeeks: 10,
  verifiedAt: "2026.08.17",
  historicalCadence: "约 8—10 周",
  officialNotice: "https://wow.blizzard.cn/news/trr/20260724/43039_1308957.html",
} as const;

const numberFormatter = new Intl.NumberFormat("zh-CN");

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function formatCompact(value: number): string {
  const normalized = Math.max(0, value);
  const formatUnit = (divisor: number, unit: string) => {
    const scaled = normalized / divisor;
    const maximumFractionDigits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits,
    }).format(scaled)} ${unit}`;
  };
  if (normalized >= 100_000_000) return formatUnit(100_000_000, "亿");
  if (normalized >= 10_000) return formatUnit(10_000, "万");
  return formatNumber(normalized);
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

function mergeLiveReport(
  current: CombatReport,
  update: CombatReport,
  fightCount: number,
): CombatReport {
  const fights = [...current.fights];
  for (const nextFight of update.fights) {
    const index = fights.findIndex((fight) => fight.id === nextFight.id);
    if (index >= 0) fights[index] = nextFight;
    else fights.push(nextFight);
  }
  return {
    ...update,
    fights: fights.slice(0, fightCount),
  };
}

function roleStyle(role: CombatRole): string {
  if (role === "tank") return "role-tank";
  if (role === "healer") return "role-healer";
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
  const shareableReport: CombatReport = {
    ...report,
    spellNames: undefined,
    unitNames: undefined,
    fights: report.fights.map((fight) => ({
      ...fight,
      timeline: undefined,
    })),
  };
  const json = JSON.stringify(shareableReport);
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

export default function WclAnalyzer({ initialNow }: { initialNow: number }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveWorkerRef = useRef<Worker | null>(null);
  const liveSourceRef = useRef<LiveLogSource | null>(null);
  const liveOffsetRef = useRef(0);
  const liveRequestIdRef = useRef(0);
  const livePollTimerRef = useRef<number | null>(null);
  const livePollBusyRef = useRef(false);
  const liveAppendPendingRef = useRef(false);
  const [report, setReport] = useState<CombatReport>(() => createDemoReport());
  const [reportKind, setReportKind] = useState<ReportKind>("demo");
  const [demoReportVisible, setDemoReportVisible] = useState(false);
  const [activeFightIds, setActiveFightIds] = useState<Set<string>>(
    () => new Set(createDemoReport().fights.map((fight) => fight.id)),
  );
  const [fightWeights, setFightWeights] = useState<Record<string, number>>({});
  const [excludedTargets, setExcludedTargets] = useState<Set<string>>(new Set());
  const [view, setView] = useState<DamageView>("boss");
  const [thresholdRank, setThresholdRank] = useState(2);
  const [thresholdPercent, setThresholdPercent] = useState(60);
  const [excludeBoosted, setExcludeBoosted] = useState(false);
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
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [liveSupported, setLiveSupported] = useState(false);
  const [liveHelperAvailable, setLiveHelperAvailable] = useState(false);
  const [localPreview, setLocalPreview] = useState(false);
  const [livePath, setLivePath] = useState("");
  const [liveStatus, setLiveStatus] = useState<LiveLogStatus>("idle");
  const [liveLastUpdate, setLiveLastUpdate] = useState<Date | null>(null);
  const [liveFileName, setLiveFileName] = useState("");
  const [phaseClock, setPhaseClock] = useState(initialNow);

  const phaseProgress = useMemo(
    () =>
      getPhaseProgress(
        {
          startedAt: TITAN_PHASE_STATUS.startedAt,
          forecastStartAt: TITAN_PHASE_STATUS.forecastStartAt,
          forecastEndAt: TITAN_PHASE_STATUS.forecastEndAt,
          timelineWeeks: TITAN_PHASE_STATUS.timelineWeeks,
        },
        new Date(phaseClock),
      ),
    [phaseClock],
  );

  useEffect(() => {
    const now = Date.now();
    const shanghaiOffset = 8 * 60 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    const untilNextShanghaiMidnight =
      dayMs - ((now + shanghaiOffset) % dayMs) + 1_000;
    const timer = window.setTimeout(
      () => setPhaseClock(Date.now()),
      untilNextShanghaiMidnight,
    );
    return () => window.clearTimeout(timer);
  }, [phaseClock]);

  const activateReport = (nextReport: CombatReport, kind: ReportKind) => {
    setReport(nextReport);
    setReportKind(kind);
    if (kind !== "demo") setDemoReportVisible(false);
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
    let cancelled = false;
    const saved = window.localStorage.getItem("time-scar-theme");
    const resolved: ThemeMode =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const isLocalPreview =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      setTheme(resolved);
      setLiveSupported(
        typeof (window as FilePickerWindow).showOpenFilePicker === "function",
      );
      setLocalPreview(isLocalPreview);
      if (isLocalPreview) {
        void fetch(`${LIVE_HELPER_ROOT}/health`, { cache: "no-store" })
          .then((response) => {
            if (!cancelled) setLiveHelperAvailable(response.ok);
          })
          .catch(() => {
            if (!cancelled) setLiveHelperAvailable(false);
          });
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(
    () => () => {
      if (livePollTimerRef.current !== null) {
        window.clearTimeout(livePollTimerRef.current);
      }
      liveWorkerRef.current?.terminate();
    },
    [],
  );

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
    const damageDealers = raw.filter(
      (player) => player.role !== "tank" && player.role !== "healer",
    );
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
        player.role !== "healer" &&
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
        player.role !== "healer" &&
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
          title: `全局小怪伤害倒数第 ${tail} 名（已过滤坦克与治疗）`,
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
  const selectedAbilityRows = useMemo(() => {
    if (!selectedPlayer) return [];
    const values = new Map<
      string,
      { spellId?: number; name: string; value: number }
    >();
    const add = (rawId: string | number | undefined, name: string, value: number) => {
      const key = rawId === undefined ? name : String(rawId);
      const current = values.get(key);
      if (current) current.value += value;
      else {
        const parsedId = rawId === undefined ? undefined : Number(rawId);
        values.set(key, {
          spellId: Number.isFinite(parsedId) ? parsedId : undefined,
          name,
          value,
        });
      }
    };

    if (view === "boss" && selectedPlayer.role === "healer") {
      for (const fight of selectedFights) {
        const weight = (fightWeights[fight.id] ?? 100) / 100;
        for (const [abilityId, healing] of Object.entries(
          fight.actorHeals?.[selectedPlayer.id] ?? {},
        )) {
          add(
            abilityId,
            report.spellNames?.[abilityId] ?? `技能 ${abilityId}`,
            healing * weight,
          );
        }
      }
    } else if (view === "boss") {
      for (const fight of selectedFights) {
        const weight = (fightWeights[fight.id] ?? 100) / 100;
        for (const [abilityId, targets] of Object.entries(
          fight.actorSpellTargets?.[selectedPlayer.id] ?? {},
        )) {
          const damage = Object.entries(targets).reduce(
            (sum, [target, amount]) =>
              excludedTargets.has(target) ? sum : sum + amount,
            0,
          );
          add(
            abilityId,
            report.spellNames?.[abilityId] ?? `技能 ${abilityId}`,
            damage * weight,
          );
        }
      }
    }

    // Older shared reports do not contain per-fight ability aggregates. The
    // complete global list remains a compatible fallback for those reports
    // and for the full/trash views.
    if (!values.size) {
      if (selectedPlayer.role === "healer" && selectedPlayer.topHeals?.length) {
        for (const spell of selectedPlayer.topHeals) {
          add(spell.spellId, spell.name, spell.healing);
        }
      } else {
        for (const spell of selectedPlayer.topSpells ?? []) {
          add(spell.spellId, spell.name, spell.damage);
        }
      }
    }
    return [...values.values()]
      .filter((spell) => spell.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN"));
  }, [
    excludedTargets,
    fightWeights,
    report.spellNames,
    selectedFights,
    selectedPlayer,
    view,
  ]);
  const selectedPrimaryTotal =
    selectedPlayer?.role === "healer"
      ? (selectedPlayer.healingDone ?? 0) + (selectedPlayer.absorbDone ?? 0)
      : selectedPlayer?.totalDamage ?? 0;

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
      for (const [target, damage] of Object.entries(
        fight.rawTargets ?? fight.targets,
      )) {
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

  const automaticExclusions = useMemo(() => {
    const values = new Map<
      string,
      { damage: number; reasons: Set<string> }
    >();
    for (const fight of selectedFights) {
      const weight = (fightWeights[fight.id] ?? 100) / 100;
      for (const exclusion of fight.automaticExclusions ?? []) {
        const current = values.get(exclusion.target) ?? {
          damage: 0,
          reasons: new Set<string>(),
        };
        current.damage += exclusion.damage * weight;
        current.reasons.add(exclusion.reason);
        values.set(exclusion.target, current);
      }
    }
    return values;
  }, [fightWeights, selectedFights]);

  const automaticAdjustments = useMemo(() => {
    const values = new Map<
      string,
      { label: string; damage: number; reason: string; actorId?: string }
    >();
    for (const fight of selectedFights) {
      const weight = (fightWeights[fight.id] ?? 100) / 100;
      for (const adjustment of fight.automaticAdjustments ?? []) {
        const key = `${adjustment.key}:${adjustment.actorId ?? "raid"}`;
        const current = values.get(key) ?? {
          label: adjustment.label,
          damage: 0,
          reason: adjustment.reason,
          actorId: adjustment.actorId,
        };
        current.damage += adjustment.damage * weight;
        values.set(key, current);
      }
    }
    return [...values.values()].sort((a, b) => b.damage - a.damage);
  }, [fightWeights, selectedFights]);

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
  const automaticExcludedDamage = [...automaticExclusions.values()].reduce(
    (sum, exclusion) => sum + exclusion.damage,
    0,
  );
  const automaticAdjustmentDamage = automaticAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.damage,
    0,
  );

  const stopLiveTracking = (announce = true) => {
    if (livePollTimerRef.current !== null) {
      window.clearTimeout(livePollTimerRef.current);
      livePollTimerRef.current = null;
    }
    liveWorkerRef.current?.terminate();
    liveWorkerRef.current = null;
    liveSourceRef.current = null;
    liveOffsetRef.current = 0;
    liveAppendPendingRef.current = false;
    livePollBusyRef.current = false;
    setLiveStatus("idle");
    setLiveFileName("");
    if (announce) setToast("已停止实时跟踪，当前报告保留在页面中");
  };

  const scheduleLivePoll = () => {
    if (!liveWorkerRef.current || !liveSourceRef.current) return;
    if (livePollTimerRef.current !== null) {
      window.clearTimeout(livePollTimerRef.current);
    }
    livePollTimerRef.current = window.setTimeout(() => {
      void pollLiveFile();
    }, 2_500);
  };

  const beginLiveSession = (file: File, source: LiveLogSource) => {
    liveWorkerRef.current?.terminate();
    const worker = createCombatLogWorker();
    const requestId = liveRequestIdRef.current + 1;
    liveWorkerRef.current = worker;
    liveSourceRef.current = source;
    liveRequestIdRef.current = requestId;
    liveOffsetRef.current = 0;
    liveAppendPendingRef.current = false;
    setLiveStatus("starting");
    setLiveFileName(file.name);
    setProcessing(true);
    setProgress(1);
    setProgressMessage("正在后台建立实时日志索引");
    setError("");

    worker.onmessage = (event: MessageEvent<CombatLogWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== liveRequestIdRef.current) return;
      if (message.type === "progress") {
        setProgress(message.progress);
        setProgressMessage(message.message);
        return;
      }
      if (message.type === "live-ready") {
        liveOffsetRef.current = message.sourceSize;
        liveAppendPendingRef.current = false;
        setLastFile(file);
        activateReport(message.report, "local");
        setLiveStatus("watching");
        setLiveLastUpdate(new Date());
        setProcessing(false);
        setProgress(100);
        setToast("实时解析已启动：后续只读取日志新增部分");
        scheduleLivePoll();
        return;
      }
      if (message.type === "live-update") {
        liveOffsetRef.current = message.sourceSize;
        liveAppendPendingRef.current = false;
        setReport((current) =>
          mergeLiveReport(current, message.report, message.fightCount),
        );
        setReportKind("local");
        setActiveFightIds((current) => {
          const next = new Set(current);
          message.report.fights.forEach((fight) => next.add(fight.id));
          return next;
        });
        setFightWeights((current) => ({
          ...current,
          ...Object.fromEntries(
            message.report.fights.map((fight) => [
              fight.id,
              current[fight.id] ?? 100,
            ]),
          ),
        }));
        setLiveLastUpdate(new Date());
        return;
      }
      if (message.type === "error") {
        setError(`实时解析中断：${message.message}`);
        setProcessing(false);
        stopLiveTracking(false);
      }
    };
    worker.onerror = (event) => {
      setError(event.message || "实时日志解析线程异常");
      setProcessing(false);
      stopLiveTracking(false);
    };
    const options: ParseOptions = {
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      mergePets: true,
    };
    worker.postMessage({ type: "live-start", requestId, file, options });
  };

  async function pollLiveFile() {
    const source = liveSourceRef.current;
    const worker = liveWorkerRef.current;
    if (!source || !worker || livePollBusyRef.current) return;
    if (liveAppendPendingRef.current) {
      scheduleLivePoll();
      return;
    }
    livePollBusyRef.current = true;
    let restarted = false;
    try {
      const offset = liveOffsetRef.current;
      const growth = await source.readGrowth(offset);
      if (growth.rotated || growth.size < offset) {
        restarted = true;
        setToast("检测到日志被清空或轮转，正在重新建立索引");
        beginLiveSession(await source.getInitialFile(), source);
        return;
      }
      if (growth.size > offset && growth.chunk?.byteLength) {
        const chunk = growth.chunk;
        liveAppendPendingRef.current = true;
        worker.postMessage(
          {
            type: "live-append",
            requestId: liveRequestIdRef.current,
            sourceSize: growth.size,
            chunk,
          },
          [chunk],
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `读取实时日志失败：${reason.message}`
          : "读取实时日志失败",
      );
    } finally {
      livePollBusyRef.current = false;
      if (!restarted) scheduleLivePoll();
    }
  }

  const startLiveTracking = async (forceLocalPath = false) => {
    if (liveStatus !== "idle") {
      stopLiveTracking();
      return;
    }
    const picker = forceLocalPath
      ? undefined
      : (window as FilePickerWindow).showOpenFilePicker;
    if (!picker && (!localPreview || !livePath.trim())) {
      setError(
        localPreview
          ? "当前内置浏览器需要填写 WoWCombatLog 的绝对路径，才能通过 localhost 只读助手实时跟踪。"
          : "当前浏览器不支持持续文件授权。请使用最新版 Chrome / Edge 后再启用实时跟踪。",
      );
      return;
    }
    try {
      let source: LiveLogSource;
      if (picker) {
        const [handle] = await picker({
          multiple: false,
          types: [
            {
              description: "魔兽世界战斗日志",
              accept: { "text/plain": [".txt", ".log"] },
            },
          ],
        });
        if (!handle) return;
        source = fileHandleLiveSource(handle);
      } else {
        source = localPathLiveSource(livePath);
        setProcessing(true);
        setProgress(1);
        setProgressMessage("正在通过 localhost 读取初始日志");
      }
      const file = await source.getInitialFile();
      if (!picker) setLiveHelperAvailable(true);
      beginLiveSession(file, source);
    } catch (reason) {
      setProcessing(false);
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      const message = reason instanceof Error ? reason.message : "无法开始实时跟踪";
      setError(
        !picker && message.toLowerCase().includes("fetch")
          ? "localhost 实时助手未启动。请重新运行 pnpm run dev 后再试。"
          : message,
      );
    }
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      window.localStorage.setItem("time-scar-theme", next);
      return next;
    });
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    stopLiveTracking(false);
    setProcessing(true);
    setProgress(2);
    setProgressMessage("正在读取日志文件");
    setError("");
    setLastFile(file);
    try {
      const parsed = await parseCombatLogFileInWorker(
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
    stopLiveTracking(false);
    activateReport(createDemoReport(), "demo");
    setDemoReportVisible(true);
    setLastFile(null);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setToast("已打开界面演示，内容均为非真实数据");
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
      ? "界面演示 · 非真实日志"
      : reportKind === "shared"
        ? "分享报告"
        : "本地日志";
  const reportVisible = reportKind !== "demo" || demoReportVisible;

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="返回页面顶部">
          <span className="brand-mark" aria-hidden="true">
            <span>时</span>
          </span>
          <span className="brand-copy">
            <strong>时光战痕</strong>
            <small>时光服 WCL 分析台</small>
          </span>
        </a>
        <nav className="top-nav" aria-label="主要导航">
          <a href="#report">{reportVisible ? "报告" : "导入日志"}</a>
          {reportVisible ? <a href="#replay">战斗复盘</a> : null}
          {reportVisible ? <a href="#compare">角色对比</a> : null}
          {reportVisible ? <a href="#rules">统计规则</a> : null}
          <a href="#phases">赛季进度</a>
          <a href="#guide">方法说明</a>
        </nav>
        <div className="header-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`切换到${theme === "dark" ? "浅色" : "深色"}模式`}
            title={`当前为${theme === "dark" ? "深色" : "浅色"}模式`}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <b>{theme === "dark" ? "浅色" : "深色"}</b>
          </button>
          <span className={`local-pill ${liveStatus === "watching" ? "is-live" : ""}`}>
            <span className="status-dot" />
            {liveStatus === "watching" ? "实时解析中" : "原始日志不上传"}
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
              TITAN REFORGED · PLAYER REVIEW WORKSPACE
            </span>
            <h1>
              战斗结束，
              <br />
              <span>复盘才刚开始。</span>
            </h1>
            <p>
              把 <strong>WoWCombatLog.txt</strong> 直接放进浏览器，按 Boss、角色和每次施法
              还原完整战斗。伤害、治疗、血量、Buff 与操作空窗，都在同一条时间线上看清楚。
            </p>
            <div className="hero-points" aria-label="产品特点">
              <span><small>01</small><b>10–30 秒</b><em>完成典型日志解析</em></span>
              <span><small>02</small><b>0 B 上传</b><em>原始日志留在本机</em></span>
              <span><small>03</small><b>逐次施法</b><em>完整时间轴可追溯</em></span>
            </div>
            <div className="hero-actions">
              <button className="button button-primary" type="button" onClick={openFilePicker}>
                <span aria-hidden="true">＋</span>
                导入战斗日志
              </button>
              <a className="button button-ghost" href="#guide">先看分析方法</a>
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
              <div className="upload-workspace-head">
                <span><i aria-hidden="true" /> LOCAL COMBAT LOG</span>
                <b>{processing ? "PARSING" : liveStatus === "watching" ? "LIVE" : "READY"}</b>
              </div>
              <div className="upload-crest" aria-hidden="true">
                <span>WCL</span>
                <small>.LOG</small>
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
                  <span className="upload-kicker">DROP TO REVIEW</span>
                  <h2>放入 WoWCombatLog.txt</h2>
                  <p>支持高级战斗日志；大文件会在浏览器内分块读取，不占用服务器带宽。</p>
                  <button className="text-button" type="button" onClick={openFilePicker}>
                    或点击选择文件 <span>→</span>
                  </button>
                </>
              )}
              <div className={`live-import ${liveStatus !== "idle" ? "is-active" : ""}`}>
                <button
                  type="button"
                  onClick={() => void startLiveTracking()}
                  aria-pressed={liveStatus !== "idle"}
                >
                  <span aria-hidden="true">
                    {liveStatus === "watching" ? "■" : "●"}
                  </span>
                  {liveStatus === "starting"
                    ? "取消实时索引"
                    : liveStatus === "watching"
                      ? "停止实时跟踪"
                      : "实时跟踪正在写入的日志"}
                </button>
                {localPreview ? (
                  <details
                    className="live-path-disclosure"
                    open={!liveSupported ? true : undefined}
                  >
                    <summary>内置浏览器 / 本地路径模式</summary>
                    <label className="live-path-field">
                      <span>日志绝对路径</span>
                      <input
                        type="text"
                        value={livePath}
                        onChange={(event) => setLivePath(event.target.value)}
                        placeholder="/Users/你的名字/.../Logs/WoWCombatLog.txt"
                        disabled={liveStatus !== "idle"}
                        spellCheck={false}
                      />
                    </label>
                    <button
                      className="live-path-start"
                      type="button"
                      onClick={() => void startLiveTracking(true)}
                      disabled={liveStatus !== "idle" || !livePath.trim()}
                    >
                      用此路径开始实时跟踪
                    </button>
                  </details>
                ) : null}
                <p>
                  {liveStatus === "watching"
                    ? `${liveFileName} · 仅增量读取新增字节${
                        liveLastUpdate
                          ? ` · ${liveLastUpdate.toLocaleTimeString("zh-CN", {
                              hour12: false,
                            })} 已同步`
                          : ""
                      }`
                    : liveSupported
                      ? "首次授权后每 2.5 秒检查新增内容；不会重复解析整份文件。"
                      : localPreview
                        ? liveHelperAvailable
                          ? "localhost 只读助手已连接；每 2.5 秒仅读取新增字节。"
                          : "localhost 只读助手未连接；重新运行 pnpm run dev 后会自动启动。"
                        : "需要支持文件持续授权的 Chrome / Edge 浏览器。"}
                </p>
              </div>
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
                原始日志只在浏览器内解析；技能图标仅按 Spell ID
                请求公开图标，不发送原始文本、聊天或账号信息。
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

        {reportVisible ? (
        <section className="report-section" id="report">
          {reportKind === "demo" ? (
            <div className="demo-report-warning" role="note">
              <span>演</span>
              <p>
                <strong>当前是界面演示，不是真实战斗日志</strong>
                页面中的玩家、伤害、Boss、时间轴和结论均为虚构数据，仅用于查看交互效果。
              </p>
            </div>
          ) : null}
          <div className="report-heading">
            <div>
              <div className="section-label">
                <span className={reportKind === "demo" ? "demo-label" : undefined}>
                  {reportKindLabel}
                </span>
                <span>核心事件解析器 v{report.parserVersion}</span>
                <span>
                  {report.advancedLogging
                    ? `高级日志${report.logVersion ? ` v${report.logVersion}` : ""}`
                    : "标准日志"}
                </span>
              </div>
              <h2>{report.raidName}</h2>
              <p>
                {report.sourceName} · {formatBytes(report.sourceSize)} · {report.timeWindow}
              </p>
            </div>
            <div className="report-actions">
              {reportKind === "demo" ? (
                <button
                  className="button button-ghost button-compact"
                  type="button"
                  onClick={() => setDemoReportVisible(false)}
                >
                  收起界面演示
                </button>
              ) : null}
              {reportKind !== "demo" && liveStatus !== "idle" ? (
                <button
                  className="button button-live button-compact"
                  type="button"
                  onClick={() => stopLiveTracking()}
                >
                  <span aria-hidden="true">●</span>
                  {liveStatus === "watching" ? "实时同步中" : "建立实时索引"}
                </button>
              ) : reportKind !== "demo" && lastFile ? (
                <button
                  className="button button-ghost button-compact"
                  type="button"
                  onClick={() => void handleFile(lastFile)}
                  disabled={processing}
                >
                  重新解析
                </button>
              ) : null}
              {reportKind !== "demo" ? (
                <>
                  <button className="button button-ghost button-compact" type="button" onClick={exportCsv}>
                    导出 CSV
                  </button>
                  <button className="button button-gold button-compact" type="button" onClick={() => void shareReport()}>
                    生成分享链接
                  </button>
                </>
              ) : null}
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
              {automaticExcludedDamage + automaticAdjustmentDamage > 0
                ? ` 已按 WCL Boss 规则自动校准 ${formatCompact(
                    automaticExcludedDamage + automaticAdjustmentDamage,
                  )}。`
                : ""}
              {excludedTargetDamage > 0
                ? ` 另手动剔除 ${formatCompact(excludedTargetDamage)}。`
                : ""}
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
                              {player.className}
                              {player.specialization ? ` · ${player.specialization}` : ""} ·{" "}
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
                      <small>
                        {selectedPlayer.specialization
                          ? `${selectedPlayer.specialization} · ${selectedPlayer.talentPoints?.join("/") ?? "天赋识别"}`
                          : "当前选中"}
                      </small>
                      <h4>{selectedPlayer.name}</h4>
                    </div>
                    <span className="detail-total">
                      <small>
                        {selectedPlayer.role === "healer" ? "治疗 + 吸收" : "当前口径"}
                      </small>
                      <strong>{formatNumber(selectedPrimaryTotal)}</strong>
                    </span>
                  </div>
                  <div className="spell-list-heading">
                    <strong>完整技能明细</strong>
                    <span>{selectedAbilityRows.length} 项 · 按技能 ID 分组</span>
                  </div>
                  <div className="spell-list">
                    {selectedAbilityRows.map((spell, index) => {
                      const topValue = selectedAbilityRows[0]?.value || 1;
                      return (
                        <div
                          className="spell-row"
                          key={spell.spellId ?? spell.name}
                          title={
                            spell.spellId !== undefined
                              ? `${spell.name} · ID ${spell.spellId}`
                              : spell.name
                          }
                        >
                          <span>{index + 1}</span>
                          <strong>
                            {spell.name}
                            {spell.spellId !== undefined ? (
                              <small>#{spell.spellId}</small>
                            ) : null}
                          </strong>
                          <div><i style={{ width: `${(spell.value / topValue) * 100}%` }} /></div>
                          <b>{formatCompact(spell.value)}</b>
                        </div>
                      );
                    })}
                  </div>
                  <div className="detail-stats">
                    <span>承伤 <b>{formatCompact(selectedPlayer.damageTaken)}</b></span>
                    <span>宠物贡献 <b>{formatCompact(selectedPlayer.petDamage)}</b></span>
                    <span>有效治疗 <b>{formatCompact(selectedPlayer.healingDone ?? 0)}</b></span>
                    <span>吸收贡献 <b>{formatCompact(selectedPlayer.absorbDone ?? 0)}</b></span>
                    <span>临时增伤 <b>{formatCompact(selectedPlayer.boostedDamage)}</b></span>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="panel rules-panel" id="rules">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">LOCAL RAID RULES</span>
                  <h3>Boss 战斗场次</h3>
                </div>
                <span className="rule-count">{activeFightIds.size}/{report.fights.length}</span>
              </div>

              <div className="rule-preset">
                <div>
                  <span className="preset-icon">W</span>
                  <p><strong>WCL 基础口径</strong><small>仅击杀 · 宠物归属 · 完全吸收 · Boss 专属排除</small></p>
                </div>
                <span>已启用</span>
              </div>

              {automaticAdjustments.length ? (
                <div className="automatic-adjustment-list">
                  {automaticAdjustments.map((adjustment) => {
                    const actorName = adjustment.actorId
                      ? report.players.find(
                          (player) => player.id === adjustment.actorId,
                        )?.name
                      : undefined;
                    return (
                      <div
                        key={`${adjustment.label}-${adjustment.actorId ?? "raid"}`}
                        title={adjustment.reason}
                      >
                        <span>自动校准</span>
                        <p>
                          <strong>{adjustment.label}</strong>
                          <small>
                            {actorName ? `${actorName} · ` : ""}
                            -{formatCompact(adjustment.damage)}
                          </small>
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <label className="switch-row">
                <span>
                  <strong>自定义：剔除临时增伤伤害</strong>
                  <small>默认关闭；开启后不再等同于 WCL Damage Done</small>
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
                    <small>
                      {automaticExclusions.size} 个自动 · {excludedTargets.size} 个手动
                    </small>
                  </span>
                  <b>{ruleTargetsOpen ? "−" : "+"}</b>
                </button>
                {ruleTargetsOpen ? (
                  <div className="target-list">
                    {targetTotals.map(([target, damage]) => {
                      const automatic = automaticExclusions.get(target);
                      const excluded = excludedTargets.has(target);
                      return (
                        <label
                          className={automatic ? "automatic" : excluded ? "excluded" : ""}
                          key={target}
                          title={automatic ? [...automatic.reasons].join("；") : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={!automatic && !excluded}
                            onChange={() => toggleTarget(target)}
                            disabled={Boolean(automatic)}
                          />
                          <span>
                            <strong>
                              {target}
                              {automatic ? <em>WCL 自动</em> : null}
                            </strong>
                            <small>
                              {formatCompact(damage)}
                              {automatic ? ` · 已排除 ${formatCompact(automatic.damage)}` : ""}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </aside>
          </div>

          <CombatReplay
            report={report}
            selectedPlayerId={selectedPlayer?.id ?? ""}
            onSelectPlayer={setSelectedPlayerId}
          />

          <PlayerComparison
            report={report}
            selectedPlayerId={selectedPlayer?.id ?? ""}
          />

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
        ) : (
          <section
            className="report-placeholder"
            id="report"
            aria-labelledby="report-placeholder-title"
          >
            <div className="report-placeholder-copy">
              <span className="report-placeholder-mark" aria-hidden="true">真</span>
              <div>
                <small>REAL LOG REQUIRED</small>
                <h2 id="report-placeholder-title">导入真实日志后显示分析报告</h2>
                <p>演示数据已默认收起，避免与真实玩家、Boss 和战斗结论混淆。</p>
              </div>
            </div>
            <details className="demo-disclosure">
              <summary>
                查看界面演示
                <span>非真实数据</span>
              </summary>
              <div>
                <p>仅用于预览页面布局和交互；其中所有角色、数值、时间轴与结论均为虚构内容。</p>
                <button className="button button-ghost button-compact" type="button" onClick={resetDemo}>
                  打开非真实演示
                </button>
              </div>
            </details>
          </section>
        )}

        <section className="phase-section" id="phases">
          <div className="phase-heading">
            <div>
              <span className="eyebrow">
                <span className="eyebrow-line" />
                TITAN REFORGED · LIVE PHASE
              </span>
              <h2>当前赛季进度</h2>
            </div>
            <p>
              只展示正在进行的阶段与下一阶段时间预估。阶段资料核对至
              {` ${TITAN_PHASE_STATUS.verifiedAt}`}，周数按北京时间自动计算。
            </p>
          </div>
          <div className="phase-dashboard">
            <article className="phase-now-card">
              <div className="phase-live-label">
                <span aria-hidden="true" />
                当前进行中
              </div>
              <div className="phase-now-title">
                <strong>{TITAN_PHASE_STATUS.phase}</strong>
                <div>
                  <span>{TITAN_PHASE_STATUS.season}</span>
                  <h3>{TITAN_PHASE_STATUS.raids}</h3>
                </div>
              </div>
              <div className="phase-week-heading">
                <div>
                  <small>阶段进度</small>
                  <strong>第 {phaseProgress.currentWeek} 周</strong>
                </div>
                <p>{TITAN_PHASE_STATUS.startedDisplay} 开始</p>
              </div>
              <div
                className="phase-week-track"
                role="img"
                aria-label={`当前为 ${TITAN_PHASE_STATUS.phase} 第 ${phaseProgress.currentWeek} 周；${TITAN_PHASE_STATUS.nextPhase} 预计在${TITAN_PHASE_STATUS.forecastWeekRange}之间开启`}
                style={
                  {
                    "--phase-week-count": phaseProgress.timelineWeeks,
                  } as CSSProperties
                }
              >
                {Array.from({ length: phaseProgress.timelineWeeks }, (_, index) => {
                  const week = index + 1;
                  const state =
                    week < phaseProgress.currentWeek
                      ? "is-complete"
                      : week === phaseProgress.currentWeek
                        ? "is-current"
                        : "is-forecast";
                  return (
                    <span className={state} key={week}>
                      <i aria-hidden="true" />
                      <b>{week}</b>
                    </span>
                  );
                })}
              </div>
              <div className="phase-week-legend" aria-hidden="true">
                <span>{TITAN_PHASE_STATUS.startedLabel}</span>
                <span>当前 · 第 {phaseProgress.currentWeek} 周</span>
                <span>预估窗口</span>
              </div>
            </article>

            <aside className="phase-forecast-card" aria-label="下一阶段预估">
              <span className="phase-forecast-kicker">PHASE FORECAST</span>
              <div className="phase-forecast-stat">
                <small>
                  {phaseProgress.forecastStatus === "before"
                    ? "预计还将持续"
                    : "P6 时间预估"}
                </small>
                <strong>{phaseProgress.estimatedRemaining}</strong>
              </div>
              <div className="phase-next-row">
                <div>
                  <small>下一阶段</small>
                  <strong>{TITAN_PHASE_STATUS.nextPhase}</strong>
                </div>
                <time dateTime={TITAN_PHASE_STATUS.forecastStartAt}>
                  预计 {TITAN_PHASE_STATUS.nextWindow}
                </time>
              </div>
              <p>
                P5 已于 8 月 6 日正式开放。官方尚未公布 P6 日期；上述窗口参考近期阶段
                {` ${TITAN_PHASE_STATUS.historicalCadence} `}
                的更替节奏，仅作预估。
              </p>
              <a
                href={TITAN_PHASE_STATUS.officialNotice}
                target="_blank"
                rel="noreferrer"
              >
                查看 P5 官方公告
                <span aria-hidden="true">↗</span>
              </a>
            </aside>
          </div>
        </section>

        <section className="guide-section" id="guide">
          <div className="guide-heading">
            <span className="eyebrow">
              <span className="eyebrow-line" />
              HOW IT WORKS
            </span>
            <h2>一份日志，三步给出能行动的结论。</h2>
              <p>团队汇总和逐事件复盘都在本机完成；官方排名、百分位和 Boss 专属口径仍以 WCL 为准。</p>
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
              <h3>按角色复盘</h3>
              <p>在同一时间轴核对技能、Boss 血量、个人 Buff、目标 Debuff、治疗、承伤和操作空窗。</p>
              <b>毫秒级事件可追溯</b>
            </article>
            <article>
              <span>03</span>
              <h3>分享汇总</h3>
              <p>把解析后的统计结果压缩进链接，队友打开即可看到相同页面和相同筛选规则。</p>
              <b>不包含聊天与账号信息</b>
            </article>
          </div>
          <div className="parser-proof">
            <div className="parser-proof-heading">
              <span>解析边界</span>
              <h3>能处理真实日志，但不冒充完整 WCL。</h3>
              <p>
                解析器已按高级战斗日志 v9 的单位快照字段校准，并用整份实战日志回归；
                页面会把直接读取、启发式推断和仍需 WCL 的部分分开说明。
              </p>
            </div>
            <div className="parser-proof-grid">
              <article className="verified">
                <span>已验证</span>
                <strong>核心战斗与复盘事件</strong>
                <p>伤害、治疗、吸收、施法成败、未命中、打断、驱散、死亡、单位血量快照与光环区间。</p>
              </article>
              <article className="estimated">
                <span>通用近似</span>
                <strong>团队复盘标签</strong>
                <p>职业与角色、开怪人、关键光环覆盖、临时增伤识别会受技能、目标和日志完整度影响。</p>
              </article>
              <article className="external">
                <span>仍需 WCL</span>
                <strong>官方排名口径</strong>
                <p>Boss 专属排除规则、百分位、专精循环、日志外缺失的主人关系与官方榜单不会伪造。</p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true"><span>时</span></span>
          <span className="brand-copy"><strong>时光战痕</strong><small>Raid logs, made readable.</small></span>
        </div>
        <p>
          社区非官方工具原型，与 Blizzard Entertainment、Warcraft Logs
          无隶属关系。最终结算请以团队规则和 WCL 官方数据为准。
        </p>
        <nav className="footer-links" aria-label="项目相关链接">
          <a
            className="footer-link footer-link-github"
            href="https://github.com/liven666/time-scar-wcl-analyzer"
            target="_blank"
            rel="noreferrer"
          >
            <span className="footer-link-mark" aria-hidden="true">GH</span>
            GitHub 源码
          </a>
          <a
            className="footer-link"
            href="https://bbs.nga.cn/read.php?tid=46923197"
            target="_blank"
            rel="noreferrer"
          >
            灵感来源：NGA 原帖
          </a>
        </nav>
      </footer>

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
