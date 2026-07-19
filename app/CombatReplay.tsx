"use client";

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  forwardRef,
  memo,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CombatAuraWindow,
  CombatReport,
  CombatTimelineEvent,
  PlayerMeta,
  TimelineEventKind,
} from "./lib/combat-log";
import {
  buildOperationActions,
  type OperationAction,
  type OperationStatus,
} from "./lib/operation-axis";

interface CombatReplayProps {
  report: CombatReport;
  selectedPlayerId: string;
  onSelectPlayer: (playerId: string) => void;
}

type EventFilter = "all" | "output" | "healing" | "survival" | "casts";

interface AuraLane {
  key: string;
  name: string;
  spellId: number;
  windows: CombatAuraWindow[];
  merged: Array<{ start: number; end: number }>;
  coverage: number;
  maxStacks: number;
}

interface SkillLane {
  key: string;
  name: string;
  kind: "output" | "healing" | "incoming";
  events: CombatTimelineEvent[];
  amount: number;
}

interface HealthSnapshot {
  t: number;
  hp: number;
  maxHp: number;
}

type LaneDetailSelection =
  | { kind: "moment"; time: number }
  | { kind: "health"; time: number }
  | { kind: "burst"; binIndex: number }
  | { kind: "skill"; laneKey: string; time?: number }
  | {
      kind: "aura";
      scope: "personal" | "target";
      laneKey: string;
      windowIndex?: number;
    }
  | { kind: "incidents"; time?: number };

interface LaneDetailEntry {
  key: string;
  title: string;
  meta: string;
  value?: string;
  time?: number;
  event?: CombatTimelineEvent;
}

interface LaneDetailModel {
  eyebrow: string;
  title: string;
  description: string;
  tone: string;
  selectedTime?: number;
  stats: Array<{ label: string; value: string; note: string }>;
  entries: LaneDetailEntry[];
}

interface TimelineDragState {
  active: boolean;
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  moved: boolean;
}

interface TimelineHoverEffect {
  label: string;
  value: string;
}

interface TimelineHoverEventDetail {
  key: string;
  time: string;
  effect: string;
  outcome: string;
}

interface TimelineHoverDetail {
  key: string;
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
  spellId: number;
  spellName: string;
  time: string;
  status: string;
  target: string;
  castDuration?: string;
  effects: TimelineHoverEffect[];
  outcomes: string[];
  bossHealth?: {
    hp: number;
    maxHp: number;
    exact: boolean;
    delta: number;
  };
  eventDetails: TimelineHoverEventDetail[];
}

interface TimelineHoverLayerHandle {
  show: (detail: TimelineHoverDetail) => void;
  hide: () => void;
}

interface OperationCell {
  index: number;
  start: number;
  end: number;
  occupied: boolean;
  actions: OperationAction[];
}

interface OperationSkillLane {
  key: string;
  spellId: number;
  name: string;
  actions: OperationAction[];
  successfulCasts: number;
  totalActions: number;
  effectAmount: number;
}

const EVENT_META: Record<
  TimelineEventKind,
  { label: string; short: string; tone: string }
> = {
  damage: { label: "造成伤害", short: "伤", tone: "damage" },
  heal: { label: "有效治疗", short: "疗", tone: "heal" },
  incoming: { label: "受到伤害", short: "承", tone: "incoming" },
  cast: { label: "施法成功", short: "成", tone: "cast" },
  "cast-start": { label: "开始施法", short: "读", tone: "cast-start" },
  "cast-failed": { label: "施法失败", short: "败", tone: "failed" },
  miss: { label: "未命中", short: "未", tone: "miss" },
  interrupt: { label: "打断", short: "断", tone: "interrupt" },
  dispel: { label: "驱散", short: "驱", tone: "dispel" },
  death: { label: "死亡", short: "亡", tone: "death" },
  resource: { label: "资源变化", short: "能", tone: "resource" },
  absorb: { label: "吸收伤害", short: "盾", tone: "absorb" },
};

const OPERATION_STATUS_META: Record<
  OperationStatus,
  { label: string; short: string }
> = {
  success: { label: "施法成功", short: "成" },
  failed: { label: "施法失败", short: "败" },
  started: { label: "仅记录施法开始", short: "读" },
  direct: { label: "直接技能事件", short: "技" },
};

const OFFENSIVE_AURA_PATTERN =
  /嗜血|英勇|冰冷血脉|奥术强化|燃烧|急速射击|狂暴|野蛮咆哮|切割|血性狂怒|鲁莽|死亡之愿|复仇之怒|恶魔变形|狂热|精华|Bloodlust|Heroism|Icy Veins|Arcane Power|Combustion|Rapid Fire|Berserk|Savage Roar|Slice and Dice|Blood Fury|Recklessness|Death Wish|Avenging Wrath|Metamorphosis/i;

const DEFENSIVE_AURA_PATTERN =
  /盾墙|破釜沉舟|盾牌格挡|冰封之韧|吸血鬼之血|白骨之盾|反魔法护罩|神圣保护|炽热防御者|树皮术|生存本能|狂暴回复|痛苦压制|守护之魂|圣盾术|Shield Wall|Last Stand|Shield Block|Icebound Fortitude|Vampiric Blood|Bone Shield|Anti-Magic Shell|Divine Protection|Ardent Defender|Barkskin|Survival Instincts|Frenzied Regeneration|Pain Suppression|Guardian Spirit|Divine Shield/i;

const numberFormatter = new Intl.NumberFormat("zh-CN");
const BIN_COUNT = 96;
const GCD_MS = 1_500;
const DEFAULT_GCD_CELL_WIDTH = 76;
const MIN_GCD_CELL_WIDTH = 40;
const MAX_GCD_CELL_WIDTH = 148;

const MISS_TYPE_LABELS: Record<string, string> = {
  MISS: "未命中",
  DODGE: "躲闪",
  PARRY: "招架",
  BLOCK: "完全格挡",
  DEFLECT: "偏斜",
  EVADE: "闪避",
  IMMUNE: "免疫",
  RESIST: "完全抵抗",
  ABSORB: "完全吸收",
  REFLECT: "反射",
};

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value));
}

function formatCompact(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 100_000_000) {
    return `${sign}${(absolute / 100_000_000).toFixed(2)}亿`;
  }
  if (absolute >= 10_000) {
    return `${sign}${(absolute / 10_000).toFixed(absolute >= 1_000_000 ? 1 : 2)}万`;
  }
  return `${sign}${formatNumber(absolute)}`;
}

function formatOffset(milliseconds: number, precise = false): string {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  return precise
    ? `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function spellName(report: CombatReport, id: number): string {
  return report.spellNames?.[String(id)] ?? (id ? `技能 ${id}` : "近战");
}

function unitName(report: CombatReport, id?: string): string {
  if (!id || id === "0000000000000000") return "无目标";
  return (
    report.players.find((player) => player.id === id)?.name ??
    report.unitNames?.[id] ??
    "未知单位"
  );
}

function operationGlyph(name: string): string {
  const normalized = name
    .replace(/^技能\s*\d+$/u, "技能")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return Array.from(normalized).slice(0, 2).join("") || "技";
}

const OperationSpellIcon = memo(function OperationSpellIcon({
  spellId,
  name,
  size = "medium",
}: {
  spellId: number;
  name: string;
  size?: "medium" | "small";
}) {
  const [loadedSpellId, setLoadedSpellId] = useState<number | null>(null);
  const [failedSpellId, setFailedSpellId] = useState<number | null>(null);
  const loadState =
    failedSpellId === spellId
      ? "failed"
      : loadedSpellId === spellId
        ? "loaded"
        : "loading";

  return (
    <span
      className={`operation-icon-frame is-${size}`}
      data-icon-state={loadState}
      aria-hidden="true"
    >
      <span className="operation-icon-fallback">{operationGlyph(name)}</span>
      {loadState !== "failed" ? (
        // The same-origin icon proxy already returns the final 56px game asset.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`operation-spell-icon ${
            loadState === "loaded" ? "is-loaded" : ""
          }`}
          src={`/api/spell-icon?spellId=${encodeURIComponent(String(spellId))}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSpellId(spellId)}
          onError={() => setFailedSpellId(spellId)}
        />
      ) : null}
    </span>
  );
});

function operationHue(spellId: number, name: string): number {
  let hash = spellId || 17;
  for (const character of name) {
    hash = (hash * 31 + character.codePointAt(0)!) % 360;
  }
  return Math.abs(hash) % 360;
}

const TimelineHoverLayer = memo(
  forwardRef<TimelineHoverLayerHandle, { bossName: string }>(
    function TimelineHoverLayer({ bossName }, ref) {
      const [hover, setHover] = useState<TimelineHoverDetail | null>(null);

      useImperativeHandle(
        ref,
        () => ({
          show: (detail) => setHover(detail),
          hide: () => setHover(null),
        }),
        [],
      );

      useEffect(() => {
        if (!hover) return;
        const closeHover = () => setHover(null);
        window.addEventListener("resize", closeHover);
        return () => window.removeEventListener("resize", closeHover);
      }, [hover]);

      if (!hover) return null;

      return (
        <aside
          className={`timeline-hover-card is-${hover.placement}`}
          style={{
            left: `${hover.left}px`,
            top: `${hover.top}px`,
            width: `${hover.width}px`,
          }}
          role="tooltip"
          aria-label={`${hover.time} ${hover.spellName} 事件详情`}
          key={hover.key}
        >
          <div className="timeline-hover-hero">
            <span
              style={
                {
                  "--operation-hue": operationHue(
                    hover.spellId,
                    hover.spellName,
                  ),
                } as CSSProperties
              }
            >
              <OperationSpellIcon
                spellId={hover.spellId}
                name={hover.spellName}
              />
            </span>
            <div>
              <small>
                {hover.time} · {hover.status}
              </small>
              <strong>{hover.spellName}</strong>
              <p>
                目标：{hover.target}
                {hover.castDuration ? ` · ${hover.castDuration}` : ""}
              </p>
            </div>
          </div>

          <div className="timeline-hover-effects">
            {hover.effects.map((effect) => (
              <div key={`${effect.label}-${effect.value}`}>
                <span>{effect.label}</span>
                <strong>{effect.value}</strong>
              </div>
            ))}
          </div>

          <div className="timeline-hover-outcome">
            <span>攻击 / 生效状态</span>
            <strong>{hover.outcomes.join(" · ")}</strong>
          </div>

          <div className="timeline-hover-health">
            <div>
              <span>{bossName} 血量</span>
              {hover.bossHealth ? (
                <b>
                  {formatPercent(
                    (hover.bossHealth.hp /
                      Math.max(1, hover.bossHealth.maxHp)) *
                      100,
                  )}
                </b>
              ) : null}
            </div>
            {hover.bossHealth ? (
              <>
                <strong>
                  {formatNumber(hover.bossHealth.hp)} /{" "}
                  {formatNumber(hover.bossHealth.maxHp)}
                </strong>
                <div className="timeline-hover-health-bar">
                  <i
                    style={{
                      width: `${
                        (hover.bossHealth.hp /
                          Math.max(1, hover.bossHealth.maxHp)) *
                        100
                      }%`,
                    }}
                  />
                </div>
                <small>
                  {hover.bossHealth.exact
                    ? "本事件单位快照"
                    : `邻近 ${hover.bossHealth.delta >= 0 ? "+" : ""}${(
                        hover.bossHealth.delta / 1000
                      ).toFixed(1)} 秒快照`}
                </small>
              </>
            ) : (
              <p>该段日志没有 Boss 血量快照，不推算虚假数值。</p>
            )}
          </div>

          {hover.eventDetails.length ? (
            <div className="timeline-hover-events">
              {hover.eventDetails.map((detail) => (
                <div key={detail.key}>
                  <span>{detail.time}</span>
                  <strong>{detail.effect}</strong>
                  <small>{detail.outcome}</small>
                </div>
              ))}
            </div>
          ) : null}

          <footer>悬停即时预览 · 点击后查看完整事件链与 Buff 上下文</footer>
        </aside>
      );
    },
  ),
);

function longestEmptyOperationRun(cells: OperationCell[]): number {
  let current = 0;
  let longest = 0;
  for (const cell of cells) {
    if (cell.occupied) {
      current = 0;
      continue;
    }
    current += 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function mergeWindows(
  windows: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  const sorted = windows
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (!last || window.start > last.end) {
      merged.push({ ...window });
    } else {
      last.end = Math.max(last.end, window.end);
    }
  }
  return merged;
}

function windowDuration(windows: Array<{ start: number; end: number }>): number {
  return mergeWindows(windows).reduce(
    (total, window) => total + window.end - window.start,
    0,
  );
}

function nearestAuraWindowIndex(
  windows: Array<{ start: number; end: number }>,
  time: number,
): number {
  const activeIndex = windows.findIndex(
    (window) => time >= window.start && time <= window.end,
  );
  if (activeIndex >= 0) return activeIndex;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  windows.forEach((window, index) => {
    const distance = Math.min(
      Math.abs(time - window.start),
      Math.abs(time - window.end),
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function groupAuras(
  report: CombatReport,
  windows: CombatAuraWindow[],
  durationMs: number,
): AuraLane[] {
  const groups = new Map<string, CombatAuraWindow[]>();
  for (const window of windows) {
    const key = String(window.spellId);
    const current = groups.get(key) ?? [];
    current.push(window);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => {
      const merged = mergeWindows(grouped);
      return {
        key,
        name: spellName(report, grouped[0]?.spellId ?? 0),
        spellId: grouped[0]?.spellId ?? 0,
        windows: grouped,
        merged,
        coverage: durationMs
          ? (windowDuration(merged) / durationMs) * 100
          : 0,
        maxStacks: Math.max(1, ...grouped.map((window) => window.maxStacks)),
      };
    })
    .sort((a, b) => b.coverage - a.coverage || a.name.localeCompare(b.name, "zh-CN"));
}

function peakWindow(
  events: CombatTimelineEvent[],
  windowMs: number,
): number {
  const sorted = events
    .filter((event) => (event.amount ?? 0) > 0)
    .sort((a, b) => a.t - b.t);
  let left = 0;
  let total = 0;
  let peak = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    total += sorted[right].amount ?? 0;
    while (sorted[right].t - sorted[left].t > windowMs) {
      total -= sorted[left].amount ?? 0;
      left += 1;
    }
    peak = Math.max(peak, total);
  }
  return peak;
}

function longestActionGap(events: CombatTimelineEvent[]): number {
  const times = [...new Set(
    events
      .filter(
        (event) =>
          event.kind === "cast" ||
          (event.kind === "damage" && !event.periodic && !event.pet) ||
          (event.kind === "heal" && !event.periodic && !event.pet),
      )
      .map((event) => event.t),
  )].sort((a, b) => a - b);
  let longest = 0;
  for (let index = 1; index < times.length; index += 1) {
    longest = Math.max(longest, times[index] - times[index - 1]);
  }
  return longest;
}

function nearestHealthSnapshot(
  samples: HealthSnapshot[],
  time: number,
): { sample: HealthSnapshot; delta: number } | undefined {
  if (!samples.length) return undefined;
  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t <= time) low = middle + 1;
    else high = middle - 1;
  }
  const before = samples[Math.max(0, high)];
  const after = samples[Math.min(samples.length - 1, low)];
  const sample =
    Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
  return { sample, delta: sample.t - time };
}

function healthAtOrBefore(
  samples: HealthSnapshot[],
  time: number,
): HealthSnapshot | undefined {
  let low = 0;
  let high = samples.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t <= time) low = middle + 1;
    else high = middle - 1;
  }
  return high >= 0 ? samples[high] : undefined;
}

function getEventHealth(
  event: CombatTimelineEvent,
  targetId: string,
  samples: HealthSnapshot[],
): { hp: number; maxHp: number; exact: boolean; delta: number } | undefined {
  if (
    event.snapshotUnitId === targetId &&
    (event.maxHp ?? 0) > 0 &&
    event.hp !== undefined
  ) {
    return {
      hp: event.hp,
      maxHp: event.maxHp ?? 0,
      exact: true,
      delta: 0,
    };
  }
  const nearby = nearestHealthSnapshot(samples, event.t);
  if (!nearby) return undefined;
  return {
    hp: nearby.sample.hp,
    maxHp: nearby.sample.maxHp,
    exact: false,
    delta: nearby.delta,
  };
}

function eventAmount(event: CombatTimelineEvent): number {
  return event.amount ?? 0;
}

function missTypeLabel(value?: string): string {
  if (!value) return "";
  return MISS_TYPE_LABELS[value.toUpperCase()] ?? value;
}

function eventOutcomeLabels(event: CombatTimelineEvent): string[] {
  const labels = [
    event.missType ? missTypeLabel(event.missType) : "",
    event.critical ? "暴击" : "",
    event.glancing ? "偏斜攻击" : "",
    event.crushing ? "碾压" : "",
    event.blocked ? `格挡 ${formatNumber(event.blocked)}` : "",
    event.resisted ? `抵抗 ${formatNumber(event.resisted)}` : "",
    event.absorbed ? `吸收 ${formatNumber(event.absorbed)}` : "",
    event.periodic ? "周期效果" : "",
  ].filter(Boolean);
  return [...new Set(labels)];
}

function eventEffectLabel(event: CombatTimelineEvent): string {
  if (event.kind === "miss") {
    const mitigated = event.absorbed ?? event.blocked ?? event.resisted ?? 0;
    return mitigated
      ? `${missTypeLabel(event.missType)} ${formatNumber(mitigated)}`
      : missTypeLabel(event.missType) || "未造成效果";
  }
  if (event.amount === undefined) return "无数值效果";
  const label =
    event.kind === "damage"
      ? "伤害"
      : event.kind === "incoming"
        ? "承伤"
        : event.kind === "heal"
          ? "治疗"
          : event.kind === "absorb"
            ? "吸收"
            : event.kind === "resource"
              ? "资源"
              : "效果";
  return `${label} ${formatNumber(event.amount)}`;
}

function clickedTimelineTime(
  event: ReactMouseEvent<HTMLElement>,
  durationMs: number,
): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = Math.max(
    0,
    Math.min(bounds.width, event.clientX - bounds.left),
  );
  return (position / Math.max(1, bounds.width)) * durationMs;
}

function TrackCursor({
  time,
  durationMs,
}: {
  time?: number;
  durationMs: number;
}) {
  if (time === undefined) return null;
  return (
    <span
      className="replay-track-cursor"
      style={{
        left: `${(Math.max(0, Math.min(durationMs, time)) / Math.max(1, durationMs)) * 100}%`,
      }}
      aria-hidden="true"
    />
  );
}

function metric(
  label: string,
  value: string,
  note: string,
  tone: string,
) {
  return { label, value, note, tone };
}

function roleMetrics(
  player: PlayerMeta,
  durationMs: number,
  events: CombatTimelineEvent[],
  targetId: string,
  personalAuras: AuraLane[],
) {
  const outgoing = events.filter(
    (event) =>
      event.kind === "damage" &&
      event.sourceActorId === player.id &&
      (!targetId || event.targetId === targetId),
  );
  const allOutgoing = events.filter(
    (event) => event.kind === "damage" && event.sourceActorId === player.id,
  );
  const healing = events.filter(
    (event) => event.kind === "heal" && event.sourceActorId === player.id,
  );
  const absorbs = events.filter(
    (event) => event.kind === "absorb" && event.sourceActorId === player.id,
  );
  const incoming = events.filter(
    (event) => event.kind === "incoming" && event.targetId === player.id,
  );
  const failures = events.filter(
    (event) =>
      event.sourceActorId === player.id &&
      (event.kind === "cast-failed" || event.kind === "miss"),
  );
  const interrupts = events.filter(
    (event) =>
      event.sourceActorId === player.id &&
      (event.kind === "interrupt" || event.kind === "dispel"),
  );
  const seconds = Math.max(0.001, durationMs / 1000);
  const damage = outgoing.reduce((sum, event) => sum + eventAmount(event), 0);
  const totalDamage = allOutgoing.reduce(
    (sum, event) => sum + eventAmount(event),
    0,
  );
  const effectiveHealing = healing.reduce(
    (sum, event) => sum + eventAmount(event),
    0,
  );
  const absorbAmount = absorbs.reduce(
    (sum, event) => sum + eventAmount(event),
    0,
  );
  const overhealing = healing.reduce(
    (sum, event) => sum + (event.overAmount ?? 0),
    0,
  );
  const incomingDamage = incoming.reduce(
    (sum, event) => sum + eventAmount(event),
    0,
  );
  const mitigated = incoming.reduce(
    (sum, event) =>
      sum +
      (event.absorbed ?? 0) +
      (event.blocked ?? 0) +
      (event.resisted ?? 0),
    0,
  );
  const actionGap = longestActionGap(
    events.filter((event) => event.sourceActorId === player.id),
  );
  const deaths = events.filter(
    (event) => event.kind === "death" && event.targetId === player.id,
  ).length;
  const defensiveCoverage = windowDuration(
    personalAuras
      .filter((aura) => DEFENSIVE_AURA_PATTERN.test(aura.name))
      .flatMap((aura) => aura.merged),
  );
  const offensiveCoverage = windowDuration(
    personalAuras
      .filter((aura) => OFFENSIVE_AURA_PATTERN.test(aura.name))
      .flatMap((aura) => aura.merged),
  );

  if (player.role === "healer") {
    const healingTargets = new Set(
      [...healing, ...absorbs]
        .map((event) => event.targetId)
        .filter((target): target is string => Boolean(target)),
    ).size;
    const largestHeal = Math.max(0, ...healing.map(eventAmount));
    const rawHealing = effectiveHealing + overhealing;
    return [
      metric(
        "有效治疗 + 吸收",
        formatCompact(effectiveHealing + absorbAmount),
        `治疗 ${formatCompact(effectiveHealing)} · 护盾 ${formatCompact(absorbAmount)}`,
        "heal",
      ),
      metric(
        "综合 HPS",
        formatNumber((effectiveHealing + absorbAmount) / seconds),
        "按整场战斗时长计算",
        "heal",
      ),
      metric(
        "过量率",
        formatPercent(rawHealing ? (overhealing / rawHealing) * 100 : 0),
        `过量 ${formatCompact(overhealing)}`,
        "warning",
      ),
      metric(
        "治疗目标",
        String(healingTargets),
        `最大单次 ${formatCompact(largestHeal)}`,
        "neutral",
      ),
      metric(
        "驱散 / 打断",
        String(interrupts.length),
        "按成功事件统计",
        "utility",
      ),
      metric(
        "最长操作空窗",
        formatOffset(actionGap, true),
        failures.length ? `${failures.length} 次失败或未命中` : "未发现失败事件",
        actionGap >= 3_000 ? "warning" : "neutral",
      ),
    ];
  }

  if (player.role === "tank") {
    return [
      metric(
        "实际承伤",
        formatCompact(incomingDamage),
        `DTPS ${formatNumber(incomingDamage / seconds)}`,
        "incoming",
      ),
      metric(
        "3 秒承伤峰值",
        formatCompact(peakWindow(incoming, 3_000)),
        "用于定位危险尖峰",
        "danger",
      ),
      metric(
        "吸收 / 格挡 / 抵抗",
        formatCompact(mitigated),
        "来自每次伤害的减免字段",
        "absorb",
      ),
      metric(
        "减伤覆盖",
        formatPercent((defensiveCoverage / Math.max(1, durationMs)) * 100),
        "按已识别防御 Buff 合并",
        "utility",
      ),
      metric(
        "Boss 输出",
        formatCompact(damage),
        `DPS ${formatNumber(damage / seconds)}`,
        "damage",
      ),
      metric(
        "死亡 / 控场",
        `${deaths} / ${interrupts.length}`,
        failures.length ? `${failures.length} 次失败或未命中` : "死亡 / 打断驱散",
        deaths ? "danger" : "neutral",
      ),
    ];
  }

  const criticalCount = outgoing.filter((event) => event.critical).length;
  const targetShare = totalDamage ? (damage / totalDamage) * 100 : 0;
  return [
    metric(
      "目标伤害",
      formatCompact(damage),
      `占个人全目标 ${formatPercent(targetShare)}`,
      "damage",
    ),
    metric(
      "目标 DPS",
      formatNumber(damage / seconds),
      `整场 ${formatOffset(durationMs)}`,
      "damage",
    ),
    metric(
      "伤害事件暴击率",
      formatPercent(outgoing.length ? (criticalCount / outgoing.length) * 100 : 0),
      `${criticalCount} / ${outgoing.length} 个事件`,
      "critical",
    ),
    metric(
      "爆发 Buff 覆盖",
      formatPercent((offensiveCoverage / Math.max(1, durationMs)) * 100),
      "按常见爆发类 Buff 识别",
      "utility",
    ),
    metric(
      "最长操作空窗",
      formatOffset(actionGap, true),
      actionGap >= 3_000 ? "建议检查跑位或断档" : "技能衔接较连续",
      actionGap >= 3_000 ? "warning" : "neutral",
    ),
    metric(
      "失败 / 未命中",
      String(failures.length),
      `打断驱散 ${interrupts.length} 次`,
      failures.length ? "warning" : "neutral",
    ),
  ];
}

function buildSkillLanes(
  report: CombatReport,
  player: PlayerMeta,
  events: CombatTimelineEvent[],
  targetId: string,
): SkillLane[] {
  const candidates = events.filter((event) => {
    if (player.role === "healer") {
      return (
        event.sourceActorId === player.id &&
        (event.kind === "heal" || event.kind === "absorb")
      );
    }
    if (player.role === "tank") {
      return (
        (event.sourceActorId === player.id &&
          event.kind === "damage" &&
          (!targetId || event.targetId === targetId)) ||
        (event.targetId === player.id && event.kind === "incoming")
      );
    }
    return (
      event.sourceActorId === player.id &&
      event.kind === "damage" &&
      (!targetId || event.targetId === targetId)
    );
  });
  const groups = new Map<string, SkillLane>();
  for (const event of candidates) {
    const kind =
      event.kind === "incoming"
        ? "incoming"
        : event.kind === "heal" || event.kind === "absorb"
          ? "healing"
          : "output";
    const key = `${kind}:${event.spellId}`;
    const current = groups.get(key) ?? {
      key,
      name: `${kind === "incoming" ? "承伤 · " : ""}${spellName(report, event.spellId)}`,
      kind,
      events: [],
      amount: 0,
    };
    current.events.push(event);
    current.amount += eventAmount(event);
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => b.amount - a.amount || b.events.length - a.events.length)
    .slice(0, 7);
}

function eventMatchesFilter(
  event: CombatTimelineEvent,
  filter: EventFilter,
  playerId: string,
) {
  if (filter === "all") return true;
  if (filter === "output") {
    return (
      event.sourceActorId === playerId &&
      (event.kind === "damage" ||
        event.kind === "miss" ||
        event.kind === "cast-failed")
    );
  }
  if (filter === "healing") {
    return (
      (event.sourceActorId === playerId &&
        (event.kind === "heal" || event.kind === "absorb")) ||
      (event.targetId === playerId && event.kind === "absorb")
    );
  }
  if (filter === "survival") {
    return (
      event.targetId === playerId &&
      (event.kind === "incoming" ||
        event.kind === "absorb" ||
        event.kind === "death" ||
        event.kind === "cast")
    );
  }
  return (
    event.kind === "cast" ||
    event.kind === "cast-start" ||
    event.kind === "cast-failed" ||
    event.kind === "miss" ||
    event.kind === "interrupt" ||
    event.kind === "dispel"
  );
}

function isRelevantEvent(
  event: CombatTimelineEvent,
  playerId: string,
  targetId: string,
) {
  return (
    event.sourceActorId === playerId ||
    event.sourceUnitId === playerId ||
    event.targetId === playerId ||
    event.sourceUnitId === targetId ||
    (event.sourceActorId === playerId && event.targetId === targetId)
  );
}

function FightEmptyState() {
  return (
    <div className="replay-empty">
      <span>⌁</span>
      <div>
        <h4>这份报告没有携带详细时间轴</h4>
        <p>
          分享链接只保留汇总数据以控制长度。请在本机重新选择原始高级日志，即可查看每次技能、Boss
          血量和 Buff / Debuff 区间。
        </p>
      </div>
    </div>
  );
}

function CombatReplay({
  report,
  selectedPlayerId,
  onSelectPlayer,
}: CombatReplayProps) {
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const operationScrollRef = useRef<HTMLDivElement>(null);
  const timelineHoverRef = useRef<TimelineHoverLayerHandle>(null);
  const timelineDragRef = useRef<TimelineDragState>({
    active: false,
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const operationDragRef = useRef<TimelineDragState>({
    active: false,
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const suppressTimelineClickRef = useRef(false);
  const suppressOperationClickRef = useRef(false);
  const firstTimelineFight =
    report.fights.find((fight) => fight.timeline?.events.length)?.id ??
    report.fights[0]?.id ??
    "";
  const [fightChoice, setFightChoice] = useState(firstTimelineFight);
  const [targetChoice, setTargetChoice] = useState("");
  const [filter, setFilter] = useState<EventFilter>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [showPeriodic, setShowPeriodic] = useState(true);
  const [showAllAuras, setShowAllAuras] = useState(false);
  const [eventLimit, setEventLimit] = useState(120);
  const [zoom, setZoom] = useState(6);
  const [operationGcdWidth, setOperationGcdWidth] = useState(
    DEFAULT_GCD_CELL_WIDTH,
  );
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [operationDragging, setOperationDragging] = useState(false);
  const [showFailedOperations, setShowFailedOperations] = useState(true);
  const [showAllOperationSkills, setShowAllOperationSkills] = useState(false);
  const [showAllOperationBuffs, setShowAllOperationBuffs] = useState(false);
  const [focusedOperationKey, setFocusedOperationKey] = useState<string | null>(
    null,
  );
  const [operationDetailOpen, setOperationDetailOpen] = useState(false);
  const [laneDetail, setLaneDetail] = useState<LaneDetailSelection | null>({
    kind: "health",
    time: 0,
  });
  const [focusedEvent, setFocusedEvent] =
    useState<CombatTimelineEvent | null>(null);

  useEffect(() => {
    if (!operationDetailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOperationDetailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [operationDetailOpen]);

  const beginTimelineDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, a, label")) return;
    const scroller = event.currentTarget;
    timelineDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
    };
    scroller.setPointerCapture(event.pointerId);
    setTimelineDragging(true);
  };

  const moveTimelineDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = timelineDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4) {
      drag.moved = true;
      event.preventDefault();
    }
    event.currentTarget.scrollLeft = drag.startScrollLeft - delta;
  };

  const finishTimelineDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = timelineDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved && !cancelled) {
      suppressTimelineClickRef.current = true;
      window.setTimeout(() => {
        suppressTimelineClickRef.current = false;
      }, 0);
    }
    timelineDragRef.current = {
      active: false,
      pointerId: -1,
      startX: 0,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    setTimelineDragging(false);
  };

  const runTimelineClick = (
    event: ReactMouseEvent<HTMLElement>,
    action: () => void,
  ) => {
    if (suppressTimelineClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressTimelineClickRef.current = false;
      return;
    }
    action();
  };

  const beginOperationDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, a, label")) return;
    const scroller = event.currentTarget;
    operationDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
    };
    scroller.setPointerCapture(event.pointerId);
    setOperationDragging(true);
  };

  const moveOperationDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = operationDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4) {
      drag.moved = true;
      event.preventDefault();
    }
    event.currentTarget.scrollLeft = drag.startScrollLeft - delta;
  };

  const finishOperationDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = operationDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved && !cancelled) {
      suppressOperationClickRef.current = true;
      window.setTimeout(() => {
        suppressOperationClickRef.current = false;
      }, 0);
    }
    operationDragRef.current = {
      active: false,
      pointerId: -1,
      startX: 0,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    setOperationDragging(false);
  };

  const runOperationClick = (
    event: ReactMouseEvent<HTMLElement>,
    action: () => void,
  ) => {
    if (suppressOperationClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressOperationClickRef.current = false;
      return;
    }
    action();
  };

  const fight =
    report.fights.find((candidate) => candidate.id === fightChoice) ??
    report.fights.find((candidate) => candidate.timeline?.events.length) ??
    report.fights[0];
  const player =
    report.players.find((candidate) => candidate.id === selectedPlayerId) ??
    report.players[0];
  const timeline = fight?.timeline;
  const targetId =
    timeline?.targets.some((target) => target.id === targetChoice)
      ? targetChoice
      : timeline?.primaryTargetId ?? timeline?.targets[0]?.id ?? "";
  const durationMs = fight?.durationMs ?? 1;
  const timelineWidth = Math.min(
    20_000,
    Math.max(1_050, Math.round((durationMs / 1000) * zoom)),
  );

  const relevantEvents = useMemo(() => {
    if (!timeline || !player) return [];
    return timeline.events
      .filter((event) => isRelevantEvent(event, player.id, targetId))
      .sort((a, b) => a.t - b.t);
  }, [player, targetId, timeline]);

  const healthSamples = useMemo<HealthSnapshot[]>(() => {
    if (!timeline || !targetId) return [];
    return timeline.events
      .filter(
        (event) =>
          event.snapshotUnitId === targetId &&
          (event.maxHp ?? 0) > 0 &&
          event.hp !== undefined,
      )
      .map((event) => ({
        t: event.t,
        hp: event.hp ?? 0,
        maxHp: event.maxHp ?? 1,
      }))
      .sort((a, b) => a.t - b.t);
  }, [targetId, timeline]);

  const personalAuras = useMemo(
    () =>
      timeline && player
        ? groupAuras(
            report,
            timeline.auras.filter(
              (window) =>
                window.auraType === "BUFF" && window.targetId === player.id,
            ),
            durationMs,
          )
        : [],
    [durationMs, player, report, timeline],
  );

  const targetDebuffs = useMemo(
    () =>
      timeline && targetId
        ? groupAuras(
            report,
            timeline.auras.filter(
              (window) =>
                window.auraType === "DEBUFF" && window.targetId === targetId,
            ),
            durationMs,
          )
        : [],
    [durationMs, report, targetId, timeline],
  );

  const operationActions = useMemo(
    () =>
      timeline && player
        ? buildOperationActions(timeline.events, player.id)
        : [],
    [player, timeline],
  );

  const operationCells = useMemo<OperationCell[]>(() => {
    const cellCount = Math.max(1, Math.ceil(durationMs / GCD_MS));
    const cells: OperationCell[] = Array.from({ length: cellCount }, (_, index) => {
      const start = index * GCD_MS;
      const end = Math.min(durationMs, start + GCD_MS);
      return {
        index,
        start,
        end,
        occupied: false,
        actions: [],
      };
    });

    for (const action of operationActions) {
      const cellIndex = Math.min(
        cells.length - 1,
        Math.max(0, Math.floor(action.startedAt / GCD_MS)),
      );
      const cell = cells[cellIndex];
      const groupKey = [
        action.status,
        action.event.spellId,
        ...action.reasons,
      ].join(":");
      const grouped = cell.actions.find(
        (candidate) =>
          [
            candidate.status,
            candidate.event.spellId,
            ...candidate.reasons,
          ].join(":") === groupKey,
      );
      if (grouped) {
        grouped.count += action.count;
        grouped.completedAt = Math.max(
          grouped.completedAt,
          action.completedAt,
        );
        grouped.castDurationMs = Math.max(
          grouped.castDurationMs,
          action.castDurationMs,
        );
        grouped.effectCount += action.effectCount;
        grouped.effectAmount += action.effectAmount;
        grouped.effectEvents.push(...action.effectEvents);
      } else {
        cell.actions.push({
          ...action,
          effectEvents: [...action.effectEvents],
          reasons: [...action.reasons],
        });
      }

      if (action.status !== "failed") {
        const occupiedEnd = Math.max(action.startedAt, action.completedAt);
        const occupiedEndIndex = Math.min(
          cells.length - 1,
          Math.max(0, Math.floor(occupiedEnd / GCD_MS)),
        );
        for (
          let index = cellIndex;
          index <= occupiedEndIndex;
          index += 1
        ) {
          cells[index].occupied = true;
        }
      }
    }

    for (const cell of cells) {
      cell.actions.sort(
        (a, b) =>
          a.startedAt - b.startedAt ||
          Number(a.status === "failed") - Number(b.status === "failed") ||
          a.event.spellId - b.event.spellId,
      );
    }
    return cells;
  }, [durationMs, operationActions]);

  const operationWidth = Math.max(
    960,
    operationCells.length * operationGcdWidth,
  );
  const visibleOperationActions = operationCells
    .flatMap((cell) => cell.actions)
    .filter(
      (action) => showFailedOperations || action.status !== "failed",
    );
  const operationSkillLanes = useMemo<OperationSkillLane[]>(() => {
    const lanes = new Map<number, OperationSkillLane>();
    for (const cell of operationCells) {
      for (const action of cell.actions) {
        if (!showFailedOperations && action.status === "failed") continue;
        const spellId = action.event.spellId;
        const current = lanes.get(spellId) ?? {
          key: `operation-skill-${spellId}`,
          spellId,
          name: spellName(report, spellId),
          actions: [],
          successfulCasts: 0,
          totalActions: 0,
          effectAmount: 0,
        };
        current.actions.push(action);
        current.totalActions += action.count;
        current.effectAmount += action.effectAmount;
        if (action.status === "success") {
          current.successfulCasts += action.count;
        }
        lanes.set(spellId, current);
      }
    }
    return [...lanes.values()].sort((a, b) => {
      const aHasCast = a.successfulCasts > 0;
      const bHasCast = b.successfulCasts > 0;
      const aHasUsefulAction = a.actions.some(
        (action) => action.status !== "failed",
      );
      const bHasUsefulAction = b.actions.some(
        (action) => action.status !== "failed",
      );
      return (
        Number(bHasCast) - Number(aHasCast) ||
        Number(bHasUsefulAction) - Number(aHasUsefulAction) ||
        b.successfulCasts - a.successfulCasts ||
        b.totalActions - a.totalActions ||
        b.effectAmount - a.effectAmount ||
        a.name.localeCompare(b.name, "zh-CN")
      );
    });
  }, [operationCells, report, showFailedOperations]);
  const visibleOperationSkillLanes = showAllOperationSkills
    ? operationSkillLanes
    : operationSkillLanes.slice(0, 10);
  const visibleOperationBuffLanes = showAllOperationBuffs
    ? personalAuras
    : personalAuras.slice(0, 10);
  const operationMajorTickMs =
    durationMs <= 120_000
      ? 5_000
      : durationMs <= 300_000
        ? 10_000
        : 30_000;
  const operationTimeTicks = Array.from(
    { length: Math.floor(durationMs / operationMajorTickMs) + 1 },
    (_, index) => index * operationMajorTickMs,
  );
  const selectedOperation =
    visibleOperationActions.find(
      (action) => action.key === focusedOperationKey,
    ) ??
    visibleOperationActions.find(
      (action) =>
        action.status === "success" || action.status === "direct",
    ) ??
    visibleOperationActions[0] ??
    null;
  const selectedOperationReferenceEvent = selectedOperation
    ? selectedOperation.effectEvents.find(
        (event) =>
          event.targetId === targetId &&
          event.snapshotUnitId === targetId &&
          (event.maxHp ?? 0) > 0,
      ) ??
      selectedOperation.effectEvents.find(
        (event) => event.targetId === targetId,
      ) ??
      selectedOperation.effectEvents[0] ??
      selectedOperation.event
    : null;
  const selectedOperationHealth =
    selectedOperationReferenceEvent && targetId
      ? getEventHealth(
          selectedOperationReferenceEvent,
          targetId,
          healthSamples,
        )
      : undefined;
  const selectedOperationEffectTotals = selectedOperation
    ? selectedOperation.effectEvents.reduce(
        (totals, event) => {
          if (event.kind === "damage") totals.damage += event.amount ?? 0;
          else if (event.kind === "heal") totals.healing += event.amount ?? 0;
          else if (event.kind === "absorb") totals.absorb += event.amount ?? 0;
          return totals;
        },
        { damage: 0, healing: 0, absorb: 0 },
      )
    : { damage: 0, healing: 0, absorb: 0 };
  const selectedOperationEffectSummary = [
    selectedOperationEffectTotals.damage
      ? `伤 ${formatCompact(selectedOperationEffectTotals.damage)}`
      : "",
    selectedOperationEffectTotals.healing
      ? `疗 ${formatCompact(selectedOperationEffectTotals.healing)}`
      : "",
    selectedOperationEffectTotals.absorb
      ? `盾 ${formatCompact(selectedOperationEffectTotals.absorb)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedOperationOutcomes = selectedOperation
    ? [
        ...new Set(
          selectedOperation.effectEvents.flatMap((event) =>
            eventOutcomeLabels(event),
          ),
        ),
      ]
    : [];
  const selectedOperationBuffs = selectedOperation
    ? personalAuras.filter((aura) =>
        aura.merged.some(
          (window) =>
            selectedOperation.startedAt >= window.start &&
            selectedOperation.startedAt <= window.end,
        ),
      )
    : [];
  const selectedOperationDebuffs = selectedOperation
    ? targetDebuffs.filter((aura) =>
        aura.merged.some(
          (window) =>
            selectedOperation.startedAt >= window.start &&
            selectedOperation.startedAt <= window.end,
        ),
      )
    : [];
  const operationSuccessfulCasts = operationActions.filter(
    (action) => action.status === "success",
  ).length;
  const operationDirectActions = operationActions.filter(
    (action) => action.status === "direct",
  ).length;
  const operationFailures = operationActions.filter(
    (action) => action.status === "failed",
  ).length;
  const operationOccupiedCells = operationCells.filter(
    (cell) => cell.occupied,
  ).length;
  const operationLongestGapCells = longestEmptyOperationRun(operationCells);

  const skillLanes = useMemo(
    () =>
      player
        ? buildSkillLanes(report, player, relevantEvents, targetId)
        : [],
    [player, relevantEvents, report, targetId],
  );

  const metrics = useMemo(
    () =>
      player
        ? roleMetrics(
            player,
            durationMs,
            relevantEvents,
            targetId,
            personalAuras,
          )
        : [],
    [durationMs, personalAuras, player, relevantEvents, targetId],
  );

  const burstBins = useMemo(() => {
    const bins = Array.from({ length: BIN_COUNT }, () => ({
      damage: 0,
      healing: 0,
      incoming: 0,
    }));
    if (!player) return bins;
    for (const event of relevantEvents) {
      const index = Math.min(
        BIN_COUNT - 1,
        Math.max(0, Math.floor((event.t / Math.max(1, durationMs)) * BIN_COUNT)),
      );
      if (
        event.kind === "damage" &&
        event.sourceActorId === player.id &&
        (!targetId || event.targetId === targetId)
      ) {
        bins[index].damage += eventAmount(event);
      } else if (
        (event.kind === "heal" || event.kind === "absorb") &&
        event.sourceActorId === player.id
      ) {
        bins[index].healing += eventAmount(event);
      } else if (
        event.kind === "incoming" &&
        event.targetId === player.id
      ) {
        bins[index].incoming += eventAmount(event);
      }
    }
    return bins;
  }, [durationMs, player, relevantEvents, targetId]);

  const healthSeries = useMemo(() => {
    return Array.from({ length: BIN_COUNT }, (_, index) => {
      const time = (durationMs * index) / Math.max(1, BIN_COUNT - 1);
      const snapshot = healthAtOrBefore(healthSamples, time);
      const percent = snapshot
        ? (snapshot.hp / Math.max(1, snapshot.maxHp)) * 100
        : 100;
      return Math.max(0, Math.min(100, percent));
    });
  }, [durationMs, healthSamples]);

  const maxBurst = Math.max(
    1,
    ...burstBins.flatMap((bin) => [bin.damage, bin.healing, bin.incoming]),
  );

  const filteredEvents = useMemo(() => {
    if (!player) return [];
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("zh-CN");
    return relevantEvents.filter((event) => {
      if (!showPeriodic && event.periodic) return false;
      if (!eventMatchesFilter(event, filter, player.id)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        spellName(report, event.spellId),
        event.extraSpellId ? spellName(report, event.extraSpellId) : "",
        unitName(report, event.sourceUnitId),
        unitName(report, event.targetId),
        event.missType ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(normalizedQuery);
    });
  }, [deferredQuery, filter, player, relevantEvents, report, showPeriodic]);

  const detailEvent =
    focusedEvent && relevantEvents.includes(focusedEvent)
      ? focusedEvent
      : filteredEvents.find(
          (event) =>
            event.kind === "damage" ||
            event.kind === "heal" ||
            event.kind === "incoming" ||
            event.kind === "cast-failed",
        ) ??
        filteredEvents[0] ??
        null;

  const detailHealth =
    detailEvent && targetId
      ? getEventHealth(detailEvent, targetId, healthSamples)
      : undefined;
  const activePersonalAuras = detailEvent
    ? personalAuras.filter((aura) =>
        aura.merged.some(
          (window) =>
            detailEvent.t >= window.start && detailEvent.t <= window.end,
        ),
      )
    : [];
  const activeTargetDebuffs = detailEvent
    ? targetDebuffs.filter((aura) =>
        aura.merged.some(
          (window) =>
            detailEvent.t >= window.start && detailEvent.t <= window.end,
        ),
      )
    : [];

  const incidentEvents = relevantEvents.filter(
    (event) =>
      event.kind === "cast-failed" ||
      event.kind === "interrupt" ||
      event.kind === "dispel" ||
      event.kind === "death",
  );
  const visiblePersonalAuras = showAllAuras
    ? personalAuras
    : personalAuras.slice(0, 7);
  const visibleTargetDebuffs = showAllAuras
    ? targetDebuffs
    : targetDebuffs.slice(0, 7);
  const axisTicks = Array.from({ length: 7 }, (_, index) => ({
    left: (index / 6) * 100,
    label: formatOffset((durationMs * index) / 6),
  }));
  const laneDetailModel = useMemo<LaneDetailModel | null>(() => {
    if (!laneDetail) return null;
    const toEventEntry = (
      event: CombatTimelineEvent,
      index: number,
    ): LaneDetailEntry => ({
      key: `${event.t}-${event.kind}-${event.spellId}-${index}`,
      title: spellName(report, event.spellId),
      meta: `${formatOffset(event.t, true)} · ${EVENT_META[event.kind].label} · ${unitName(
        report,
        event.targetId,
      )}`,
      value:
        event.amount !== undefined ? formatCompact(event.amount) : undefined,
      time: event.t,
      event,
    });

    if (laneDetail.kind === "moment") {
      const time = Math.max(0, Math.min(durationMs, laneDetail.time));
      const nearbyEvents = relevantEvents
        .filter((event) => Math.abs(event.t - time) <= 1_000)
        .sort((a, b) => a.t - b.t);
      const health = nearestHealthSnapshot(healthSamples, time);
      const activeBuffs = personalAuras.filter((aura) =>
        aura.merged.some(
          (window) => time >= window.start && time <= window.end,
        ),
      );
      const activeDebuffs = targetDebuffs.filter((aura) =>
        aura.merged.some(
          (window) => time >= window.start && time <= window.end,
        ),
      );
      return {
        eyebrow: "TIME SLICE",
        title: `${formatOffset(time, true)} 战斗切片`,
        description:
          "显示这个时间点前后各 1 秒内的事件，以及当时可用的血量与光环状态。",
        tone: "moment",
        selectedTime: time,
        stats: [
          {
            label: "附近事件",
            value: String(nearbyEvents.length),
            note: "±1 秒窗口",
          },
          {
            label: "Boss 血量",
            value: health
              ? formatPercent(
                  (health.sample.hp /
                    Math.max(1, health.sample.maxHp)) *
                    100,
                )
              : "—",
            note: health
              ? `快照相差 ${Math.abs(health.delta / 1000).toFixed(1)} 秒`
              : "没有血量快照",
          },
          {
            label: "个人 Buff",
            value: String(activeBuffs.length),
            note: activeBuffs.slice(0, 2).map((aura) => aura.name).join("、") || "无",
          },
          {
            label: "目标 Debuff",
            value: String(activeDebuffs.length),
            note:
              activeDebuffs.slice(0, 2).map((aura) => aura.name).join("、") ||
              "无",
          },
        ],
        entries: nearbyEvents.slice(0, 18).map(toEventEntry),
      };
    }

    if (laneDetail.kind === "health") {
      const time = Math.max(0, Math.min(durationMs, laneDetail.time));
      const selected = nearestHealthSnapshot(healthSamples, time);
      const first = healthSamples[0];
      const final = healthSamples.at(-1);
      const minimum = [...healthSamples].sort(
        (a, b) =>
          a.hp / Math.max(1, a.maxHp) - b.hp / Math.max(1, b.maxHp),
      )[0];
      const nearby = [...healthSamples]
        .sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time))
        .slice(0, 12)
        .sort((a, b) => a.t - b.t);
      return {
        eyebrow: "HEALTH TRACK",
        title: `${unitName(report, targetId)} 血量轨道`,
        description: selected
          ? `当前查看 ${formatOffset(time, true)}，最近的真实快照位于 ${formatOffset(
              selected.sample.t,
              true,
            )}。`
          : "该目标没有高级日志血量快照。",
        tone: "health",
        selectedTime: time,
        stats: [
          {
            label: "所选血量",
            value: selected
              ? formatPercent(
                  (selected.sample.hp /
                    Math.max(1, selected.sample.maxHp)) *
                    100,
                )
              : "—",
            note: selected
              ? `${formatCompact(selected.sample.hp)} / ${formatCompact(
                  selected.sample.maxHp,
                )}`
              : "无快照",
          },
          {
            label: "开场快照",
            value: first
              ? formatPercent((first.hp / Math.max(1, first.maxHp)) * 100)
              : "—",
            note: first ? formatOffset(first.t, true) : "无快照",
          },
          {
            label: "最低快照",
            value: minimum
              ? formatPercent(
                  (minimum.hp / Math.max(1, minimum.maxHp)) * 100,
                )
              : "—",
            note: minimum ? formatOffset(minimum.t, true) : "无快照",
          },
          {
            label: "快照数量",
            value: healthSamples.length.toLocaleString("zh-CN"),
            note: final
              ? `最后快照 ${formatOffset(final.t, true)}`
              : "无快照",
          },
        ],
        entries: nearby.map((snapshot, index) => ({
          key: `${snapshot.t}-${snapshot.hp}-${index}`,
          title: `${formatPercent(
            (snapshot.hp / Math.max(1, snapshot.maxHp)) * 100,
          )} · ${formatCompact(snapshot.hp)}`,
          meta: `${formatOffset(snapshot.t, true)} · 目标血量快照`,
          value: formatCompact(snapshot.maxHp),
          time: snapshot.t,
        })),
      };
    }

    if (laneDetail.kind === "burst") {
      const binIndex = Math.max(
        0,
        Math.min(BIN_COUNT - 1, laneDetail.binIndex),
      );
      const start = (durationMs * binIndex) / BIN_COUNT;
      const end = (durationMs * (binIndex + 1)) / BIN_COUNT;
      const bin = burstBins[binIndex];
      const binEvents = relevantEvents
        .filter((event) => event.t >= start && event.t < end)
        .sort((a, b) => eventAmount(b) - eventAmount(a));
      const largest = Math.max(bin.damage, bin.healing, bin.incoming);
      return {
        eyebrow: "INTENSITY SLICE",
        title: `${formatOffset(start, true)}—${formatOffset(end, true)} 战斗强度`,
        description:
          "该柱代表这段时间内当前角色的目标输出、有效治疗/吸收和实际承伤。",
        tone: "burst",
        selectedTime: (start + end) / 2,
        stats: [
          {
            label: "目标输出",
            value: formatCompact(bin.damage),
            note: largest === bin.damage && largest > 0 ? "本段最高项" : "本段累计",
          },
          {
            label: "治疗 / 吸收",
            value: formatCompact(bin.healing),
            note: largest === bin.healing && largest > 0 ? "本段最高项" : "本段累计",
          },
          {
            label: "实际承伤",
            value: formatCompact(bin.incoming),
            note: largest === bin.incoming && largest > 0 ? "本段最高项" : "本段累计",
          },
          {
            label: "详细事件",
            value: String(binEvents.length),
            note: `区间 ${(end - start).toFixed(0)} ms`,
          },
        ],
        entries: binEvents.slice(0, 18).map(toEventEntry),
      };
    }

    if (laneDetail.kind === "skill") {
      const lane = skillLanes.find(
        (candidate) => candidate.key === laneDetail.laneKey,
      );
      if (!lane) return null;
      const criticalCount = lane.events.filter((event) => event.critical).length;
      const periodicCount = lane.events.filter((event) => event.periodic).length;
      const maximum = Math.max(0, ...lane.events.map(eventAmount));
      const targetCount = new Set(
        lane.events
          .map((event) => event.targetId)
          .filter((target): target is string => Boolean(target)),
      ).size;
      const selectedTime = laneDetail.time ?? lane.events[0]?.t;
      const selectedEvents =
        selectedTime === undefined
          ? [...lane.events].sort((a, b) => eventAmount(b) - eventAmount(a))
          : [...lane.events]
              .sort(
                (a, b) =>
                  Math.abs(a.t - selectedTime) - Math.abs(b.t - selectedTime),
              )
              .slice(0, 18)
              .sort((a, b) => a.t - b.t);
      return {
        eyebrow: "SKILL TRACK",
        title: lane.name,
        description: `${lane.kind === "incoming" ? "承伤来源" : lane.kind === "healing" ? "治疗/吸收技能" : "目标输出技能"}的完整轨道统计。`,
        tone: lane.kind,
        selectedTime,
        stats: [
          {
            label: "累计数值",
            value: formatCompact(lane.amount),
            note: `${lane.events.length} 个事件`,
          },
          {
            label: "平均每次",
            value: formatCompact(
              lane.events.length ? lane.amount / lane.events.length : 0,
            ),
            note: `最大 ${formatCompact(maximum)}`,
          },
          {
            label: "暴击事件",
            value: formatPercent(
              lane.events.length
                ? (criticalCount / lane.events.length) * 100
                : 0,
            ),
            note: `${criticalCount} 次暴击`,
          },
          {
            label: "周期 / 目标",
            value: `${periodicCount} / ${targetCount}`,
            note: "周期事件 / 不同目标",
          },
        ],
        entries: selectedEvents.map(toEventEntry),
      };
    }

    if (laneDetail.kind === "aura") {
      const lanes =
        laneDetail.scope === "personal" ? personalAuras : targetDebuffs;
      const aura = lanes.find(
        (candidate) => candidate.key === laneDetail.laneKey,
      );
      if (!aura) return null;
      const selectedWindow =
        aura.merged[
          Math.max(
            0,
            Math.min(
              aura.merged.length - 1,
              laneDetail.windowIndex ?? 0,
            ),
          )
        ];
      const sources = new Set(
        aura.windows
          .map((window) => window.sourceActorId ?? window.sourceUnitId)
          .filter((source): source is string => Boolean(source)),
      );
      return {
        eyebrow:
          laneDetail.scope === "personal" ? "PERSONAL BUFF" : "TARGET DEBUFF",
        title: aura.name,
        description:
          laneDetail.scope === "personal"
            ? `查看 ${player?.name ?? "当前角色"} 身上该 Buff 的所有生效区间。`
            : `查看 ${unitName(report, targetId)} 身上该 Debuff 的所有生效区间。`,
        tone: laneDetail.scope === "personal" ? "aura" : "debuff",
        selectedTime: selectedWindow?.start,
        stats: [
          {
            label: "覆盖率",
            value: formatPercent(aura.coverage),
            note: `累计 ${formatOffset(windowDuration(aura.merged))}`,
          },
          {
            label: "生效区间",
            value: String(aura.merged.length),
            note: "重叠区间已合并",
          },
          {
            label: "最高层数",
            value: String(aura.maxStacks),
            note: aura.maxStacks > 1 ? "日志记录的最高层数" : "单层光环",
          },
          {
            label: "施加来源",
            value: String(sources.size),
            note:
              [...sources]
                .slice(0, 2)
                .map((source) => unitName(report, source))
                .join("、") || "未知",
          },
        ],
        entries: aura.merged.map((window, index) => ({
          key: `${window.start}-${window.end}-${index}`,
          title: `${formatOffset(window.start, true)}—${formatOffset(
            window.end,
            true,
          )}`,
          meta: `持续 ${formatOffset(window.end - window.start, true)}`,
          value: `${((window.end - window.start) / 1000).toFixed(1)} 秒`,
          time: window.start,
        })),
      };
    }

    const selectedTime = laneDetail.time;
    const failed = incidentEvents.filter(
      (event) => event.kind === "cast-failed",
    ).length;
    const utility = incidentEvents.filter(
      (event) => event.kind === "interrupt" || event.kind === "dispel",
    ).length;
    const deaths = incidentEvents.filter(
      (event) => event.kind === "death",
    ).length;
    const selectedEvents =
      selectedTime === undefined
        ? incidentEvents
        : [...incidentEvents]
            .sort(
              (a, b) =>
                Math.abs(a.t - selectedTime) -
                Math.abs(b.t - selectedTime),
            )
            .slice(0, 18)
            .sort((a, b) => a.t - b.t);
    return {
      eyebrow: "INCIDENT TRACK",
      title: "关键事件轨道",
      description:
        "汇总施法失败、打断、驱散与死亡；点击下面的事件可继续查看毫秒级现场。",
      tone: "incident",
      selectedTime,
      stats: [
        {
          label: "关键事件",
          value: String(incidentEvents.length),
          note: "当前角色和目标相关",
        },
        {
          label: "施法失败",
          value: String(failed),
          note: "包含冷却、目标等原因",
        },
        {
          label: "打断 / 驱散",
          value: String(utility),
          note: "成功事件",
        },
        {
          label: "死亡",
          value: String(deaths),
          note: deaths ? "建议结合承伤轨道复盘" : "当前视角无死亡",
        },
      ],
      entries: selectedEvents.slice(0, 18).map(toEventEntry),
    };
  }, [
    burstBins,
    durationMs,
    healthSamples,
    incidentEvents,
    laneDetail,
    personalAuras,
    player?.name,
    relevantEvents,
    report,
    skillLanes,
    targetDebuffs,
    targetId,
  ]);
  const selectedTimelineTime = laneDetailModel?.selectedTime;
  const selectLaneDetailEntry = (entry: LaneDetailEntry) => {
    if (entry.event) setFocusedEvent(entry.event);
    if (entry.time === undefined) return;
    setLaneDetail((current) => {
      if (!current) return { kind: "moment", time: entry.time ?? 0 };
      if (current.kind === "moment" || current.kind === "health") {
        return { ...current, time: entry.time ?? 0 };
      }
      if (current.kind === "burst") {
        return {
          kind: "burst",
          binIndex: Math.min(
            BIN_COUNT - 1,
            Math.floor(
              ((entry.time ?? 0) / Math.max(1, durationMs)) * BIN_COUNT,
            ),
          ),
        };
      }
      if (current.kind === "skill" || current.kind === "incidents") {
        return { ...current, time: entry.time };
      }
      const lanes =
        current.scope === "personal" ? personalAuras : targetDebuffs;
      const aura = lanes.find(
        (candidate) => candidate.key === current.laneKey,
      );
      return {
        ...current,
        windowIndex: aura
          ? nearestAuraWindowIndex(aura.merged, entry.time ?? 0)
          : current.windowIndex,
      };
    });
  };

  const hoverPosition = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const preferredWidth =
      viewportWidth >= 2560 ? 520 : viewportWidth >= 1680 ? 460 : 390;
    const width = Math.max(280, Math.min(preferredWidth, viewportWidth - 24));
    const centeredLeft = bounds.left + bounds.width / 2 - width / 2;
    const left = Math.max(
      12,
      Math.min(viewportWidth - width - 12, centeredLeft),
    );
    const spaceAbove = bounds.top;
    const spaceBelow = viewportHeight - bounds.bottom;
    const placement =
      spaceAbove >= 360 || spaceAbove > spaceBelow ? "above" : "below";
    return {
      left,
      top: placement === "above" ? bounds.top - 10 : bounds.bottom + 10,
      width,
      placement,
    } as const;
  };

  const showOperationHover = (
    element: HTMLElement,
    action: OperationAction,
    name: string,
  ) => {
    const referenceEvent =
      action.effectEvents.find(
        (event) =>
          event.targetId === targetId &&
          event.snapshotUnitId === targetId &&
          (event.maxHp ?? 0) > 0,
      ) ??
      action.effectEvents.find((event) => event.targetId === targetId) ??
      action.effectEvents[0] ??
      action.event;
    const totals = action.effectEvents.reduce(
      (result, event) => {
        if (event.kind === "damage") result.damage += event.amount ?? 0;
        else if (event.kind === "heal") result.healing += event.amount ?? 0;
        else if (event.kind === "absorb") result.absorb += event.amount ?? 0;
        result.over += event.overAmount ?? 0;
        result.blocked += event.blocked ?? 0;
        result.resisted += event.resisted ?? 0;
        if (event.kind !== "absorb") {
          result.mitigatedAbsorb += event.absorbed ?? 0;
        }
        return result;
      },
      {
        damage: 0,
        healing: 0,
        absorb: 0,
        over: 0,
        blocked: 0,
        resisted: 0,
        mitigatedAbsorb: 0,
      },
    );
    const effects = [
      totals.damage
        ? { label: "伤害", value: formatNumber(totals.damage) }
        : null,
      totals.healing
        ? { label: "治疗", value: formatNumber(totals.healing) }
        : null,
      totals.absorb
        ? { label: "吸收效果", value: formatNumber(totals.absorb) }
        : null,
      totals.over
        ? { label: "过量 / 过杀", value: formatNumber(totals.over) }
        : null,
      totals.blocked
        ? { label: "被格挡", value: formatNumber(totals.blocked) }
        : null,
      totals.resisted
        ? { label: "被抵抗", value: formatNumber(totals.resisted) }
        : null,
      totals.mitigatedAbsorb
        ? { label: "被吸收", value: formatNumber(totals.mitigatedAbsorb) }
        : null,
    ].filter((effect): effect is TimelineHoverEffect => Boolean(effect));
    if (!effects.length) {
      effects.push({
        label: "有效效果",
        value: action.effectEvents.length
          ? `${action.effectEvents.length} 条事件`
          : "日志未关联数值",
      });
    }
    const outcomes = [
      ...action.effectEvents.flatMap((event) => eventOutcomeLabels(event)),
      ...action.reasons.map((reason) => missTypeLabel(reason)),
    ].filter(Boolean);
    const uniqueOutcomes = [...new Set(outcomes)];
    if (!uniqueOutcomes.length) {
      uniqueOutcomes.push(
        action.status === "failed"
          ? "未生效"
          : action.effectEvents.length
            ? "普通命中 / 生效"
            : "未记录命中结果",
      );
    }
    const bossHealth = targetId
      ? getEventHealth(referenceEvent, targetId, healthSamples)
      : undefined;
    timelineHoverRef.current?.show({
      key: action.key,
      ...hoverPosition(element),
      spellId: action.event.spellId,
      spellName: name,
      time: formatOffset(action.startedAt, true),
      status: `${OPERATION_STATUS_META[action.status].label}${
        action.count > 1 ? ` ×${action.count}` : ""
      }`,
      target: unitName(report, referenceEvent.targetId),
      castDuration: action.castDurationMs
        ? `${(action.castDurationMs / 1000).toFixed(3)} 秒读条`
        : "瞬发 / 未记录读条",
      effects,
      outcomes: uniqueOutcomes,
      bossHealth,
      eventDetails: action.effectEvents.slice(0, 3).map((event, index) => ({
        key: `${event.t}-${event.kind}-${event.spellId}-${index}`,
        time: formatOffset(event.t, true),
        effect: `${EVENT_META[event.kind].label} · ${eventEffectLabel(event)}`,
        outcome: eventOutcomeLabels(event).join(" · ") || "普通命中 / 生效",
      })),
    });
  };

  const showTimelineEventHover = (
    element: HTMLElement,
    event: CombatTimelineEvent,
    name: string,
  ) => {
    const amountLabel =
      event.kind === "damage"
        ? "伤害"
        : event.kind === "incoming"
          ? "承伤"
          : event.kind === "heal"
            ? "治疗"
            : event.kind === "absorb"
              ? "吸收"
              : event.kind === "resource"
                ? "资源"
                : "有效效果";
    const effects: TimelineHoverEffect[] = [];
    if (event.amount !== undefined) {
      effects.push({ label: amountLabel, value: formatNumber(event.amount) });
    } else {
      effects.push({ label: amountLabel, value: eventEffectLabel(event) });
    }
    if (
      event.rawAmount !== undefined &&
      event.rawAmount !== event.amount
    ) {
      effects.push({ label: "原始量", value: formatNumber(event.rawAmount) });
    }
    if (event.overAmount) {
      effects.push({
        label: "过量 / 过杀",
        value: formatNumber(event.overAmount),
      });
    }
    if (event.blocked) {
      effects.push({ label: "被格挡", value: formatNumber(event.blocked) });
    }
    if (event.resisted) {
      effects.push({ label: "被抵抗", value: formatNumber(event.resisted) });
    }
    if (event.absorbed && event.kind !== "absorb") {
      effects.push({ label: "被吸收", value: formatNumber(event.absorbed) });
    }
    const outcomes = eventOutcomeLabels(event);
    if (!outcomes.length) {
      outcomes.push(
        event.kind === "cast-failed" || event.kind === "miss"
          ? "未生效"
          : "普通命中 / 生效",
      );
    }
    timelineHoverRef.current?.show({
      key: `timeline-${event.t}-${event.kind}-${event.spellId}`,
      ...hoverPosition(element),
      spellId: event.spellId,
      spellName: name,
      time: formatOffset(event.t, true),
      status: EVENT_META[event.kind].label,
      target: unitName(report, event.targetId),
      effects,
      outcomes,
      bossHealth: targetId
        ? getEventHealth(event, targetId, healthSamples)
        : undefined,
      eventDetails: [],
    });
  };

  if (!fight || !player) {
    return null;
  }

  return (
    <section className="panel replay-panel" id="replay">
      <div className="replay-heading">
        <div>
          <span className="panel-kicker">COMBAT REPLAY</span>
          <h3>战斗复盘时间轴</h3>
          <p>
            把技能、血量、Buff、Debuff、承伤和治疗放在同一条时间线上，逐事件定位手法问题。
          </p>
        </div>
        <div className="replay-selectors">
          <label>
            <span>Boss 场次</span>
            <select
              value={fight.id}
              onChange={(event) => {
                setFightChoice(event.target.value);
                setTargetChoice("");
                setFocusedEvent(null);
                setFocusedOperationKey(null);
                setOperationDetailOpen(false);
                timelineHoverRef.current?.hide();
                setShowAllOperationSkills(false);
                setShowAllOperationBuffs(false);
                setLaneDetail({ kind: "health", time: 0 });
                setEventLimit(120);
                if (operationScrollRef.current) {
                  operationScrollRef.current.scrollLeft = 0;
                }
              }}
            >
              {report.fights.map((candidate, index) => (
                <option value={candidate.id} key={candidate.id}>
                  {index + 1}. {candidate.name} · {candidate.success ? "击杀" : "失败"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>复盘角色</span>
            <select
              value={player.id}
              onChange={(event) => {
                onSelectPlayer(event.target.value);
                setFocusedEvent(null);
                setFocusedOperationKey(null);
                setOperationDetailOpen(false);
                timelineHoverRef.current?.hide();
                setShowAllOperationSkills(false);
                setShowAllOperationBuffs(false);
                setLaneDetail({ kind: "health", time: 0 });
                setEventLimit(120);
                if (operationScrollRef.current) {
                  operationScrollRef.current.scrollLeft = 0;
                }
              }}
            >
              {report.players.map((candidate) => (
                <option value={candidate.id} key={candidate.id}>
                  {candidate.name} · {candidate.className}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>观察目标</span>
            <select
              value={targetId}
              onChange={(event) => {
                setTargetChoice(event.target.value);
                setFocusedEvent(null);
                setOperationDetailOpen(false);
                timelineHoverRef.current?.hide();
                setLaneDetail({ kind: "health", time: 0 });
              }}
              disabled={!timeline?.targets.length}
            >
              {timeline?.targets.map((target) => (
                <option value={target.id} key={target.id}>
                  {target.name} · {formatCompact(target.damage)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!timeline ? (
        <FightEmptyState />
      ) : (
        <>
          <div className="replay-context">
            <div>
              <span className={`replay-role role-${player.role}`}>
                {player.role === "tank"
                  ? "坦克视角"
                  : player.role === "healer"
                    ? "治疗视角"
                    : "输出视角"}
              </span>
              <strong>{player.name}</strong>
              <small>
                {fight.name} · {formatOffset(durationMs)} ·{" "}
                {timeline.events.length.toLocaleString("zh-CN")} 条战斗事件
              </small>
            </div>
            <div className="replay-legend" aria-label="时间轴图例">
              <span className="damage">输出</span>
              <span className="heal">治疗 / 吸收</span>
              <span className="incoming">承伤</span>
              <span className="aura">Buff / Debuff</span>
            </div>
          </div>

          <div className="replay-metrics">
            {metrics.map((item) => (
              <article className={`replay-metric tone-${item.tone}`} key={item.label}>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
                <span>{item.note}</span>
              </article>
            ))}
          </div>

          <section
            className="operation-axis-panel"
            aria-labelledby="operation-axis-title"
          >
            <div className="operation-axis-heading">
              <div>
                <span className="panel-kicker">PLAYER ROTATION</span>
                <h4 id="operation-axis-title">玩家操作轴</h4>
                <p>
                  所有技能共享同一把时间尺：上方按技能分轨显示施法图标，下方显示个人 Buff
                  持续区间；背景竖线每格固定 1.5 秒公共 CD。悬停技能即可查看伤害、命中状态与 Boss 血量。
                </p>
              </div>
              <div className="operation-axis-actions">
                <div
                  className="zoom-control operation-zoom-control"
                  aria-label="玩家操作轴缩放"
                >
                  <span>时间密度</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOperationGcdWidth((value) =>
                        Math.max(MIN_GCD_CELL_WIDTH, value - 12),
                      )
                    }
                    disabled={operationGcdWidth <= MIN_GCD_CELL_WIDTH}
                    aria-label="缩小玩家操作轴"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={MIN_GCD_CELL_WIDTH}
                    max={MAX_GCD_CELL_WIDTH}
                    step={12}
                    value={operationGcdWidth}
                    onChange={(event) =>
                      setOperationGcdWidth(Number(event.target.value))
                    }
                    aria-label="玩家操作轴每个公共 CD 的宽度"
                  />
                  <b>{operationGcdWidth} px / GCD</b>
                  <button
                    type="button"
                    onClick={() =>
                      setOperationGcdWidth((value) =>
                        Math.min(MAX_GCD_CELL_WIDTH, value + 12),
                      )
                    }
                    disabled={operationGcdWidth >= MAX_GCD_CELL_WIDTH}
                    aria-label="放大玩家操作轴"
                  >
                    ＋
                  </button>
                </div>
                <label className="operation-failure-toggle">
                  <input
                    type="checkbox"
                    checked={showFailedOperations}
                    onChange={(event) =>
                      setShowFailedOperations(event.target.checked)
                    }
                  />
                  <span>显示失败尝试</span>
                </label>
                {operationSkillLanes.length > 10 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setShowAllOperationSkills((value) => !value)
                    }
                  >
                    {showAllOperationSkills
                      ? "收起技能"
                      : `全部技能 ${operationSkillLanes.length}`}
                  </button>
                ) : null}
                {personalAuras.length > 10 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setShowAllOperationBuffs((value) => !value)
                    }
                  >
                    {showAllOperationBuffs
                      ? "收起 Buff"
                      : `全部 Buff ${personalAuras.length}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    operationScrollRef.current?.scrollTo({
                      left: 0,
                      behavior: "smooth",
                    })
                  }
                >
                  回到开头
                </button>
              </div>
            </div>

            <div className="operation-axis-summary">
              <article>
                <small>成功施法</small>
                <strong>{operationSuccessfulCasts}</strong>
                <span>
                  另有 {operationDirectActions} 个日志仅记录直接技能
                </span>
              </article>
              <article>
                <small>公共 CD 占用</small>
                <strong>
                  {operationOccupiedCells} / {operationCells.length}
                </strong>
                <span>
                  {formatPercent(
                    (operationOccupiedCells /
                      Math.max(1, operationCells.length)) *
                      100,
                  )}{" "}
                  的 1.5 秒格有动作
                </span>
              </article>
              <article>
                <small>失败尝试</small>
                <strong>{operationFailures}</strong>
                <span>冷却、目标、距离等日志原始原因</span>
              </article>
              <article>
                <small>最长空格</small>
                <strong>
                  {formatOffset(operationLongestGapCells * GCD_MS, true)}
                </strong>
                <span>{operationLongestGapCells} 个连续公共 CD 格</span>
              </article>
            </div>

            <div
              ref={operationScrollRef}
              className={`operation-axis-scroll ${operationDragging ? "is-dragging" : ""}`}
              onPointerDown={beginOperationDrag}
              onPointerMove={moveOperationDrag}
              onPointerUp={(event) => finishOperationDrag(event)}
              onPointerCancel={(event) => finishOperationDrag(event, true)}
            >
              <div
                className="operation-axis-canvas"
                style={{
                  width: `calc(${operationWidth}px + var(--operation-label-width))`,
                }}
              >
                <div className="operation-ruler-row">
                  <div className="operation-sticky-label">
                    <strong>{player.name}</strong>
                    <small>{player.className} · 1.5 秒公共 CD 网格</small>
                  </div>
                  <div
                    className="operation-time-ruler"
                    style={
                      {
                        width: `${operationWidth}px`,
                        "--gcd-width": `${operationGcdWidth}px`,
                      } as CSSProperties
                    }
                    onClick={(event) =>
                      runOperationClick(event, () =>
                        setLaneDetail({
                          kind: "moment",
                          time: clickedTimelineTime(event, durationMs),
                        }),
                      )
                    }
                  >
                    {operationTimeTicks.map((time) => (
                      <span
                        key={`operation-time-${time}`}
                        style={{
                          left: `${(time / Math.max(1, durationMs)) * 100}%`,
                        }}
                      >
                        <b>{formatOffset(time)}</b>
                        <i aria-hidden="true" />
                      </span>
                    ))}
                  </div>
                </div>

                <div className="operation-section-row">
                  <div className="operation-sticky-label">
                    <strong>技能</strong>
                    <small>
                      显示 {visibleOperationSkillLanes.length} /{" "}
                      {operationSkillLanes.length} 条技能轨道
                    </small>
                  </div>
                  <div
                    className="operation-section-track"
                    style={
                      {
                        width: `${operationWidth}px`,
                        "--gcd-width": `${operationGcdWidth}px`,
                      } as CSSProperties
                    }
                  >
                    每种技能独立成行 · 悬停图标即时看效果与 Boss 血量 · 紫色横条表示读条
                  </div>
                </div>

                {visibleOperationSkillLanes.map((skillLane) => {
                  const hue = operationHue(skillLane.spellId, skillLane.name);
                  return (
                    <div className="operation-lane-row" key={skillLane.key}>
                      <div className="operation-lane-label">
                        <a
                          className="operation-lane-icon-link"
                          href={`https://www.wowhead.com/wotlk/spell=${skillLane.spellId}`}
                          style={
                            { "--operation-hue": hue } as CSSProperties
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            const action = skillLane.actions[0];
                            if (!action) return;
                            const referenceEvent =
                              action.effectEvents.find(
                                (effect) => effect.targetId === targetId,
                              ) ??
                              action.effectEvents[0] ??
                              action.event;
                            setFocusedOperationKey(action.key);
                            setOperationDetailOpen(true);
                            setFocusedEvent(referenceEvent);
                            setLaneDetail({
                              kind: "moment",
                              time: action.startedAt,
                            });
                          }}
                        >
                          <OperationSpellIcon
                            spellId={skillLane.spellId}
                            name={skillLane.name}
                          />
                        </a>
                        <span>
                          <strong>{skillLane.name}</strong>
                          <small>
                            {skillLane.successfulCasts
                              ? `${skillLane.successfulCasts} 次成功施法`
                              : `${skillLane.totalActions} 次直接技能 / 失败尝试`}
                          </small>
                        </span>
                      </div>
                      <div
                        className="operation-lane-track"
                        style={
                          {
                            width: `${operationWidth}px`,
                            "--gcd-width": `${operationGcdWidth}px`,
                          } as CSSProperties
                        }
                        onClick={(event) =>
                          runOperationClick(event, () =>
                            setLaneDetail({
                              kind: "moment",
                              time: clickedTimelineTime(event, durationMs),
                            }),
                          )
                        }
                      >
                        {skillLane.actions.map((action) => {
                          const referenceEvent =
                            action.effectEvents.find(
                              (effect) => effect.targetId === targetId,
                            ) ??
                            action.effectEvents[0] ??
                            action.event;
                          return (
                            <a
                              className={[
                                "operation-lane-event",
                                `status-${action.status}`,
                                selectedOperation?.key === action.key
                                  ? "is-active"
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              key={action.key}
                              href={`https://www.wowhead.com/wotlk/spell=${action.event.spellId}`}
                              style={
                                {
                                  left: `${(action.startedAt / Math.max(1, durationMs)) * 100}%`,
                                  "--operation-hue": hue,
                                  "--cast-width": `${Math.max(
                                    0,
                                    (action.castDurationMs /
                                      Math.max(1, durationMs)) *
                                      operationWidth,
                                  )}px`,
                                } as CSSProperties
                              }
                              aria-label={`${formatOffset(action.startedAt, true)} ${skillLane.name} ${OPERATION_STATUS_META[action.status].label}`}
                              onPointerEnter={(event) =>
                                showOperationHover(
                                  event.currentTarget,
                                  action,
                                  skillLane.name,
                                )
                              }
                              onPointerLeave={() =>
                                timelineHoverRef.current?.hide()
                              }
                              onFocus={(event) =>
                                showOperationHover(
                                  event.currentTarget,
                                  action,
                                  skillLane.name,
                                )
                              }
                              onBlur={() => timelineHoverRef.current?.hide()}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                timelineHoverRef.current?.hide();
                                setFocusedOperationKey(action.key);
                                setOperationDetailOpen(true);
                                setFocusedEvent(referenceEvent);
                                setLaneDetail({
                                  kind: "moment",
                                  time: action.startedAt,
                                });
                              }}
                            >
                              {action.castDurationMs >= 500 ? (
                                <i
                                  className="operation-lane-cast-bar"
                                  aria-hidden="true"
                                />
                              ) : null}
                              <OperationSpellIcon
                                spellId={action.event.spellId}
                                name={skillLane.name}
                              />
                              {action.count > 1 ? (
                                <b className="operation-action-count">
                                  ×{action.count}
                                </b>
                              ) : null}
                              {action.status === "failed" ? (
                                <b className="operation-action-failed">!</b>
                              ) : null}
                              {action.castDurationMs >= 500 ? (
                                <em className="operation-cast-duration">
                                  {(action.castDurationMs / 1000).toFixed(1)}s
                                </em>
                              ) : null}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="operation-section-row is-buff-section">
                  <div className="operation-sticky-label">
                    <strong>Buff</strong>
                    <small>
                      显示 {visibleOperationBuffLanes.length} /{" "}
                      {personalAuras.length} 条增益轨道
                    </small>
                  </div>
                  <div
                    className="operation-section-track"
                    style={
                      {
                        width: `${operationWidth}px`,
                        "--gcd-width": `${operationGcdWidth}px`,
                      } as CSSProperties
                    }
                  >
                    Buff 位于技能下方 · 色块长度代表实际持续时间与覆盖区间
                  </div>
                </div>

                {visibleOperationBuffLanes.map((aura) => {
                  const hue = operationHue(aura.spellId, aura.name);
                  return (
                    <div
                      className={`operation-lane-row buff-lane ${
                        laneDetail?.kind === "aura" &&
                        laneDetail.scope === "personal" &&
                        laneDetail.laneKey === aura.key
                          ? "is-selected"
                          : ""
                      }`}
                      key={`operation-buff-${aura.key}`}
                    >
                      <div className="operation-lane-label">
                        <a
                          className="operation-lane-icon-link"
                          href={`https://www.wowhead.com/wotlk/spell=${aura.spellId}`}
                          style={
                            { "--operation-hue": hue } as CSSProperties
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            setLaneDetail({
                              kind: "aura",
                              scope: "personal",
                              laneKey: aura.key,
                              windowIndex: 0,
                            });
                          }}
                        >
                          <OperationSpellIcon
                            spellId={aura.spellId}
                            name={aura.name}
                          />
                        </a>
                        <span>
                          <strong>{aura.name}</strong>
                          <small>
                            覆盖 {formatPercent(aura.coverage)} · 最高{" "}
                            {aura.maxStacks} 层
                          </small>
                        </span>
                      </div>
                      <div
                        className="operation-lane-track operation-buff-track"
                        style={
                          {
                            width: `${operationWidth}px`,
                            "--gcd-width": `${operationGcdWidth}px`,
                            "--operation-hue": hue,
                          } as CSSProperties
                        }
                        onClick={(event) =>
                          runOperationClick(event, () =>
                            setLaneDetail({
                              kind: "moment",
                              time: clickedTimelineTime(event, durationMs),
                            }),
                          )
                        }
                      >
                        {aura.merged.map((window, windowIndex) => (
                          <button
                            type="button"
                            className="operation-buff-window"
                            key={`${aura.key}-${window.start}-${window.end}`}
                            style={{
                              left: `${(window.start / Math.max(1, durationMs)) * 100}%`,
                              width: `${Math.max(
                                0.2,
                                ((window.end - window.start) /
                                  Math.max(1, durationMs)) *
                                  100,
                              )}%`,
                            }}
                            title={`${aura.name} · ${formatOffset(window.start, true)}—${formatOffset(window.end, true)} · ${formatOffset(window.end - window.start, true)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setLaneDetail({
                                kind: "aura",
                                scope: "personal",
                                laneKey: aura.key,
                                windowIndex,
                              });
                            }}
                          >
                            <OperationSpellIcon
                              spellId={aura.spellId}
                              name={aura.name}
                              size="small"
                            />
                            <b>
                              {formatOffset(window.end - window.start, true)}
                            </b>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="operation-axis-legend">
              <span className="success">施法成功</span>
              <span className="direct">直接技能 / 触发</span>
              <span className="failed">失败尝试</span>
              <span className="casting">紫色横条为读条时间</span>
              <p>
                竖线间隔 1.5 秒；按住轨道空白处左右拖动；悬停技能看即时数据，点击进入完整事件链。
              </p>
            </div>

            {selectedOperation && operationDetailOpen ? (
              <div
                className="operation-detail-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setOperationDetailOpen(false);
                  }
                }}
              >
                <aside
                  className="operation-detail-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="operation-detail-title"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button
                    className="operation-detail-close"
                    type="button"
                    onClick={() => setOperationDetailOpen(false)}
                    aria-label="关闭技能详情"
                  >
                    ×
                  </button>
                <div className="operation-detail-hero">
                  <span
                    className={`operation-detail-glyph status-${selectedOperation.status}`}
                    style={
                      {
                        "--operation-hue": operationHue(
                          selectedOperation.event.spellId,
                          spellName(
                            report,
                            selectedOperation.event.spellId,
                          ),
                        ),
                      } as CSSProperties
                    }
                  >
                    {operationGlyph(
                      spellName(report, selectedOperation.event.spellId),
                    )}
                  </span>
                  <div>
                    <small>
                      GCD #
                      {Math.floor(selectedOperation.startedAt / GCD_MS) + 1} ·{" "}
                      {formatOffset(selectedOperation.startedAt, true)}
                      {selectedOperation.completedAt >
                      selectedOperation.startedAt
                        ? ` → ${formatOffset(selectedOperation.completedAt, true)}`
                        : ""}
                    </small>
                    <h4 id="operation-detail-title">
                      {spellName(report, selectedOperation.event.spellId)}
                    </h4>
                    <p>
                      {OPERATION_STATUS_META[selectedOperation.status].label} ·{" "}
                      {unitName(
                        report,
                        selectedOperationReferenceEvent?.targetId ??
                          selectedOperation.event.targetId,
                      )}
                      {selectedOperation.count > 1
                        ? ` · 同格 ${selectedOperation.count} 次`
                        : ""}
                    </p>
                  </div>
                </div>

                <dl className="operation-detail-stats">
                  <div>
                    <dt>读条时间</dt>
                    <dd>
                      {selectedOperation.castDurationMs
                        ? `${(
                            selectedOperation.castDurationMs / 1000
                          ).toFixed(3)} 秒`
                        : "瞬发 / 未记录"}
                    </dd>
                  </div>
                  <div>
                    <dt>伤害 / 治疗 / 吸收</dt>
                    <dd title={selectedOperationEffectSummary}>
                      {selectedOperationEffectSummary || "—"}
                    </dd>
                    <small>
                      {selectedOperation.effectCount
                        ? `${selectedOperation.effectCount} 条关联效果事件`
                        : "日志未关联数值事件"}
                    </small>
                  </div>
                  <div>
                    <dt>Boss 当时血量</dt>
                    <dd
                      title={
                        selectedOperationHealth
                          ? `${formatNumber(selectedOperationHealth.hp)} / ${formatNumber(selectedOperationHealth.maxHp)}`
                          : undefined
                      }
                    >
                      {selectedOperationHealth
                        ? `${formatCompact(selectedOperationHealth.hp)} / ${formatCompact(selectedOperationHealth.maxHp)}`
                        : "—"}
                    </dd>
                    <small>
                      {selectedOperationHealth
                        ? `${formatPercent(
                            (selectedOperationHealth.hp /
                              Math.max(1, selectedOperationHealth.maxHp)) *
                              100,
                          )} · ${
                            selectedOperationHealth.exact
                              ? "本事件快照"
                              : `邻近 ${selectedOperationHealth.delta >= 0 ? "+" : ""}${(
                                  selectedOperationHealth.delta / 1000
                                ).toFixed(1)} 秒`
                          }`
                        : "日志没有可用血量快照"}
                    </small>
                  </div>
                  <div>
                    <dt>资源快照</dt>
                    <dd>
                      {selectedOperation.event.resource !== undefined
                        ? `${formatNumber(selectedOperation.event.resource)} / ${formatNumber(
                            selectedOperation.event.resourceMax ?? 0,
                          )}`
                        : "—"}
                    </dd>
                    <small>
                      {selectedOperation.event.resourceType !== undefined
                        ? `日志资源类型 ${selectedOperation.event.resourceType}`
                        : "该施法没有资源字段"}
                    </small>
                  </div>
                  <div>
                    <dt>命中 / 攻击状态</dt>
                    <dd title={selectedOperationOutcomes.join(" · ")}>
                      {selectedOperationOutcomes.join(" · ") ||
                        (selectedOperation.status === "failed"
                          ? "未生效"
                          : "命中 / 生效")}
                    </dd>
                    <small>
                      {selectedOperation.reasons.length
                        ? `失败：${selectedOperation.reasons.join("、")}`
                        : "暴击、未命中、格挡、招架、躲闪等"}
                    </small>
                  </div>
                </dl>

                <div className="operation-aura-context">
                  <div>
                    <strong>施法时个人 Buff</strong>
                    <span>
                      {selectedOperationBuffs.length
                        ? selectedOperationBuffs
                            .map((aura) => aura.name)
                            .join(" · ")
                        : "没有记录到生效 Buff"}
                    </span>
                  </div>
                  <div>
                    <strong>目标 Debuff</strong>
                    <span>
                      {selectedOperationDebuffs.length
                        ? selectedOperationDebuffs
                            .map((aura) => aura.name)
                            .join(" · ")
                        : "没有记录到生效 Debuff"}
                    </span>
                  </div>
                </div>

                <div className="operation-effect-events">
                  <div>
                    <strong>这次操作关联的效果事件</strong>
                    <span>
                      {selectedOperation.effectEvents.length
                        ? `显示前 ${Math.min(
                            10,
                            selectedOperation.effectEvents.length,
                          )} 条`
                        : "没有可关联事件"}
                    </span>
                  </div>
                  {selectedOperation.effectEvents.length ? (
                    <div>
                      {selectedOperation.effectEvents
                        .slice(0, 10)
                        .map((event, index) => {
                          const health = targetId
                            ? getEventHealth(event, targetId, healthSamples)
                            : undefined;
                          const outcomes = eventOutcomeLabels(event);
                          return (
                            <button
                              type="button"
                              key={`${event.t}-${event.kind}-${event.spellId}-${index}`}
                              onClick={() => {
                                setFocusedEvent(event);
                                setLaneDetail({
                                  kind: "moment",
                                  time: event.t,
                                });
                              }}
                            >
                              <span>{formatOffset(event.t, true)}</span>
                              <strong>
                                {EVENT_META[event.kind].label} ·{" "}
                                {unitName(report, event.targetId)}
                              </strong>
                              <b>{eventEffectLabel(event)}</b>
                              <small className="operation-effect-outcome">
                                {outcomes.join(" · ") || "普通命中 / 生效"}
                              </small>
                              <small className="operation-effect-health">
                                {health
                                  ? `Boss ${formatNumber(health.hp)} / ${formatNumber(health.maxHp)} · ${formatPercent(
                                      (health.hp /
                                        Math.max(1, health.maxHp)) *
                                        100,
                                    )}`
                                  : "Boss 血量：日志无快照"}
                              </small>
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    <p>
                      只有施法事件，没有同技能的直接伤害/治疗事件；被动触发与高级日志缺失会单独标为“直接技能”。
                    </p>
                  )}
                </div>
                </aside>
              </div>
            ) : !selectedOperation ? (
              <div className="operation-detail-empty">
                当前角色没有可用的玩家施法事件。
              </div>
            ) : null}
          </section>

          <div className="replay-toolbar">
            <div>
              <strong>统一战斗横轴</strong>
              <span>
                按住空白区域左右拖动；点击任意轨道、柱段、技能点或光环区间查看详情
              </span>
            </div>
            <div className="replay-toolbar-actions">
              <span className="drag-hint">
                <b>↔</b> 拖动平移
              </span>
              <div className="zoom-control" aria-label="时间轴缩放">
                <span>缩放</span>
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.max(2, value - 2))}
                  disabled={zoom <= 2}
                >
                  −
                </button>
                <input
                  type="range"
                  min={2}
                  max={30}
                  step={1}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  aria-label="统一战斗横轴缩放比例"
                />
                <b>{zoom} px/s</b>
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.min(30, value + 2))}
                  disabled={zoom >= 30}
                >
                  ＋
                </button>
              </div>
            </div>
          </div>

          <div
            ref={timelineScrollRef}
            className={`replay-scroll ${timelineDragging ? "is-dragging" : ""}`}
            onPointerDown={beginTimelineDrag}
            onPointerMove={moveTimelineDrag}
            onPointerUp={(event) => finishTimelineDrag(event)}
            onPointerCancel={(event) => finishTimelineDrag(event, true)}
          >
            <div
              className="replay-canvas"
              style={{
                width: `calc(${timelineWidth}px + var(--replay-label-width))`,
              }}
            >
              <div
                className={`replay-axis-row ${laneDetail?.kind === "moment" ? "is-selected" : ""}`}
              >
                <button
                  className="replay-sticky-label replay-lane-button"
                  type="button"
                  onClick={() =>
                    setLaneDetail({
                      kind: "moment",
                      time: selectedTimelineTime ?? 0,
                    })
                  }
                >
                  <strong>战斗时间</strong>
                  <small>点击横轴查看时间切片</small>
                </button>
                <div
                  className="replay-axis"
                  style={{ width: `${timelineWidth}px` }}
                  role="button"
                  tabIndex={0}
                  aria-label="点击时间横轴查看该时刻详情"
                  onClick={(event) =>
                    runTimelineClick(event, () =>
                      setLaneDetail({
                        kind: "moment",
                        time: clickedTimelineTime(event, durationMs),
                      }),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setLaneDetail({
                        kind: "moment",
                        time: selectedTimelineTime ?? 0,
                      });
                    }
                  }}
                >
                  <TrackCursor
                    time={selectedTimelineTime}
                    durationMs={durationMs}
                  />
                  {axisTicks.map((tick) => (
                    <span
                      className={`replay-axis-tick ${
                        tick.left === 0
                          ? "first"
                          : tick.left === 100
                            ? "last"
                            : ""
                      }`}
                      style={{ left: `${tick.left}%` }}
                      key={`${tick.left}-${tick.label}`}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              <div
                className={`replay-track-row health-row ${laneDetail?.kind === "health" ? "is-selected" : ""}`}
              >
                <button
                  className="replay-sticky-label replay-lane-button"
                  type="button"
                  onClick={() =>
                    setLaneDetail({
                      kind: "health",
                      time: selectedTimelineTime ?? 0,
                    })
                  }
                >
                  <strong>{unitName(report, targetId)}</strong>
                  <small>Boss 血量快照 · 点击查看详情</small>
                </button>
                <div
                  className="replay-track replay-health-track"
                  style={{ width: `${timelineWidth}px` }}
                  onClick={(event) =>
                    runTimelineClick(event, () =>
                      setLaneDetail({
                        kind: "health",
                        time: clickedTimelineTime(event, durationMs),
                      }),
                    )
                  }
                >
                  <TrackCursor
                    time={selectedTimelineTime}
                    durationMs={durationMs}
                  />
                  {healthSamples.length ? (
                    healthSeries.map((percent, index) => {
                      const time =
                        (durationMs * index) / Math.max(1, BIN_COUNT - 1);
                      return (
                        <button
                          className="health-sample-button"
                          type="button"
                          title={`${formatOffset(time, true)} · ${percent.toFixed(1)}%`}
                          aria-label={`${formatOffset(time, true)} Boss 血量 ${percent.toFixed(1)}%`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setLaneDetail({ kind: "health", time });
                          }}
                          key={index}
                        >
                          <i style={{ height: `${percent}%` }} />
                        </button>
                      );
                    })
                  ) : (
                    <span className="track-empty">日志没有可用的目标血量快照</span>
                  )}
                </div>
              </div>

              <div
                className={`replay-track-row burst-row ${laneDetail?.kind === "burst" ? "is-selected" : ""}`}
              >
                <button
                  className="replay-sticky-label replay-lane-button"
                  type="button"
                  onClick={() =>
                    setLaneDetail({
                      kind: "burst",
                      binIndex: Math.min(
                        BIN_COUNT - 1,
                        Math.floor(
                          ((selectedTimelineTime ?? 0) /
                            Math.max(1, durationMs)) *
                            BIN_COUNT,
                        ),
                      ),
                    })
                  }
                >
                  <strong>战斗强度</strong>
                  <small>每段输出 / 治疗 / 承伤 · 点击查看</small>
                </button>
                <div
                  className="replay-track replay-burst-track"
                  style={{ width: `${timelineWidth}px` }}
                  onClick={(event) =>
                    runTimelineClick(event, () => {
                      const time = clickedTimelineTime(event, durationMs);
                      setLaneDetail({
                        kind: "burst",
                        binIndex: Math.min(
                          BIN_COUNT - 1,
                          Math.floor(
                            (time / Math.max(1, durationMs)) * BIN_COUNT,
                          ),
                        ),
                      });
                    })
                  }
                >
                  <TrackCursor
                    time={selectedTimelineTime}
                    durationMs={durationMs}
                  />
                  {burstBins.map((bin, index) => (
                    <button
                      className="replay-burst-column"
                      type="button"
                      title={`${formatOffset((durationMs * index) / BIN_COUNT, true)}—${formatOffset((durationMs * (index + 1)) / BIN_COUNT, true)} · 输出 ${formatCompact(bin.damage)} · 治疗 ${formatCompact(bin.healing)} · 承伤 ${formatCompact(bin.incoming)}`}
                      aria-label={`查看第 ${index + 1} 个战斗强度区间`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLaneDetail({ kind: "burst", binIndex: index });
                      }}
                      key={index}
                    >
                      <i
                        className="damage"
                        style={{ height: `${(bin.damage / maxBurst) * 100}%` }}
                      />
                      <i
                        className="heal"
                        style={{ height: `${(bin.healing / maxBurst) * 100}%` }}
                      />
                      <i
                        className="incoming"
                        style={{ height: `${(bin.incoming / maxBurst) * 100}%` }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {skillLanes.map((lane) => (
                <div
                  className={`replay-track-row skill-row ${
                    laneDetail?.kind === "skill" &&
                    laneDetail.laneKey === lane.key
                      ? "is-selected"
                      : ""
                  }`}
                  key={lane.key}
                >
                  <button
                    className="replay-sticky-label replay-lane-button"
                    type="button"
                    onClick={() =>
                      setLaneDetail({
                        kind: "skill",
                        laneKey: lane.key,
                        time: selectedTimelineTime,
                      })
                    }
                  >
                    <strong>{lane.name}</strong>
                    <small>
                      {lane.events.length} 次 · {formatCompact(lane.amount)} · 点击查看
                    </small>
                  </button>
                  <div
                    className={`replay-track replay-skill-track lane-${lane.kind}`}
                    style={{ width: `${timelineWidth}px` }}
                    onClick={(event) =>
                      runTimelineClick(event, () =>
                        setLaneDetail({
                          kind: "skill",
                          laneKey: lane.key,
                          time: clickedTimelineTime(event, durationMs),
                        }),
                      )
                    }
                  >
                    <TrackCursor
                      time={selectedTimelineTime}
                      durationMs={durationMs}
                    />
                    {lane.events.slice(0, 420).map((event, index) => (
                      <button
                        className={`${event.periodic ? "periodic" : ""} ${detailEvent === event ? "active" : ""}`}
                        type="button"
                        style={{
                          left: `${(event.t / Math.max(1, durationMs)) * 100}%`,
                        }}
                        aria-label={`${formatOffset(event.t, true)} ${lane.name} ${eventEffectLabel(event)}`}
                        onPointerEnter={(pointerEvent) =>
                          showTimelineEventHover(
                            pointerEvent.currentTarget,
                            event,
                            lane.name,
                          )
                        }
                        onPointerLeave={() =>
                          timelineHoverRef.current?.hide()
                        }
                        onFocus={(focusEvent) =>
                          showTimelineEventHover(
                            focusEvent.currentTarget,
                            event,
                            lane.name,
                          )
                        }
                        onBlur={() => timelineHoverRef.current?.hide()}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          timelineHoverRef.current?.hide();
                          setFocusedEvent(event);
                          setLaneDetail({
                            kind: "skill",
                            laneKey: lane.key,
                            time: event.t,
                          });
                        }}
                        key={`${event.t}-${event.spellId}-${index}`}
                      />
                    ))}
                    {lane.events.length > 420 ? (
                      <span className="lane-density-note">
                        高密度技能点已采样显示；完整事件见下表
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}

              {visiblePersonalAuras.map((aura) => (
                <div
                  className={`replay-track-row aura-row ${
                    laneDetail?.kind === "aura" &&
                    laneDetail.scope === "personal" &&
                    laneDetail.laneKey === aura.key
                      ? "is-selected"
                      : ""
                  }`}
                  key={`personal-${aura.key}`}
                >
                  <button
                    className="replay-sticky-label replay-lane-button"
                    type="button"
                    onClick={() =>
                      setLaneDetail({
                        kind: "aura",
                        scope: "personal",
                        laneKey: aura.key,
                        windowIndex: nearestAuraWindowIndex(
                          aura.merged,
                          selectedTimelineTime ?? 0,
                        ),
                      })
                    }
                  >
                    <strong>{aura.name}</strong>
                    <small>
                      个人 Buff · {formatPercent(aura.coverage)}
                      {aura.maxStacks > 1 ? ` · ${aura.maxStacks} 层` : ""} · 点击查看
                    </small>
                  </button>
                  <div
                    className="replay-track replay-aura-track"
                    style={{ width: `${timelineWidth}px` }}
                    onClick={(event) =>
                      runTimelineClick(event, () => {
                        const time = clickedTimelineTime(event, durationMs);
                        setLaneDetail({
                          kind: "aura",
                          scope: "personal",
                          laneKey: aura.key,
                          windowIndex: nearestAuraWindowIndex(
                            aura.merged,
                            time,
                          ),
                        });
                      })
                    }
                  >
                    <TrackCursor
                      time={selectedTimelineTime}
                      durationMs={durationMs}
                    />
                    {aura.merged.map((window, index) => (
                      <button
                        className="personal"
                        type="button"
                        style={
                          {
                            left: `${(window.start / Math.max(1, durationMs)) * 100}%`,
                            width: `${((window.end - window.start) / Math.max(1, durationMs)) * 100}%`,
                            "--aura-hue": String(
                              ((Math.abs(aura.spellId) * 37) % 90) + 125,
                            ),
                          } as CSSProperties
                        }
                        title={`${aura.name} · ${formatOffset(window.start)}—${formatOffset(window.end)}`}
                        aria-label={`${aura.name} ${formatOffset(window.start, true)} 到 ${formatOffset(window.end, true)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setLaneDetail({
                            kind: "aura",
                            scope: "personal",
                            laneKey: aura.key,
                            windowIndex: index,
                          });
                        }}
                        key={`${window.start}-${window.end}-${index}`}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {visibleTargetDebuffs.map((aura) => (
                <div
                  className={`replay-track-row aura-row ${
                    laneDetail?.kind === "aura" &&
                    laneDetail.scope === "target" &&
                    laneDetail.laneKey === aura.key
                      ? "is-selected"
                      : ""
                  }`}
                  key={`target-${aura.key}`}
                >
                  <button
                    className="replay-sticky-label replay-lane-button"
                    type="button"
                    onClick={() =>
                      setLaneDetail({
                        kind: "aura",
                        scope: "target",
                        laneKey: aura.key,
                        windowIndex: nearestAuraWindowIndex(
                          aura.merged,
                          selectedTimelineTime ?? 0,
                        ),
                      })
                    }
                  >
                    <strong>{aura.name}</strong>
                    <small>
                      目标 Debuff · {formatPercent(aura.coverage)}
                      {aura.maxStacks > 1 ? ` · ${aura.maxStacks} 层` : ""} · 点击查看
                    </small>
                  </button>
                  <div
                    className="replay-track replay-aura-track"
                    style={{ width: `${timelineWidth}px` }}
                    onClick={(event) =>
                      runTimelineClick(event, () => {
                        const time = clickedTimelineTime(event, durationMs);
                        setLaneDetail({
                          kind: "aura",
                          scope: "target",
                          laneKey: aura.key,
                          windowIndex: nearestAuraWindowIndex(
                            aura.merged,
                            time,
                          ),
                        });
                      })
                    }
                  >
                    <TrackCursor
                      time={selectedTimelineTime}
                      durationMs={durationMs}
                    />
                    {aura.merged.map((window, index) => (
                      <button
                        className="debuff"
                        type="button"
                        style={{
                          left: `${(window.start / Math.max(1, durationMs)) * 100}%`,
                          width: `${((window.end - window.start) / Math.max(1, durationMs)) * 100}%`,
                        }}
                        title={`${aura.name} · ${formatOffset(window.start)}—${formatOffset(window.end)}`}
                        aria-label={`${aura.name} ${formatOffset(window.start, true)} 到 ${formatOffset(window.end, true)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setLaneDetail({
                            kind: "aura",
                            scope: "target",
                            laneKey: aura.key,
                            windowIndex: index,
                          });
                        }}
                        key={`${window.start}-${window.end}-${index}`}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div
                className={`replay-track-row incident-row ${laneDetail?.kind === "incidents" ? "is-selected" : ""}`}
              >
                <button
                  className="replay-sticky-label replay-lane-button"
                  type="button"
                  onClick={() =>
                    setLaneDetail({
                      kind: "incidents",
                      time: selectedTimelineTime,
                    })
                  }
                >
                  <strong>关键事件</strong>
                  <small>失败 / 打断 / 驱散 / 死亡 · 点击查看</small>
                </button>
                <div
                  className="replay-track replay-incident-track"
                  style={{ width: `${timelineWidth}px` }}
                  onClick={(event) =>
                    runTimelineClick(event, () =>
                      setLaneDetail({
                        kind: "incidents",
                        time: clickedTimelineTime(event, durationMs),
                      }),
                    )
                  }
                >
                  <TrackCursor
                    time={selectedTimelineTime}
                    durationMs={durationMs}
                  />
                  {incidentEvents.map((event, index) => (
                    <button
                      className={`incident-${EVENT_META[event.kind].tone} ${detailEvent === event ? "active" : ""}`}
                      type="button"
                      style={{
                        left: `${(event.t / Math.max(1, durationMs)) * 100}%`,
                      }}
                      aria-label={`${formatOffset(event.t, true)} ${EVENT_META[event.kind].label} ${spellName(report, event.spellId)}`}
                      onPointerEnter={(pointerEvent) =>
                        showTimelineEventHover(
                          pointerEvent.currentTarget,
                          event,
                          spellName(report, event.spellId),
                        )
                      }
                      onPointerLeave={() =>
                        timelineHoverRef.current?.hide()
                      }
                      onFocus={(focusEvent) =>
                        showTimelineEventHover(
                          focusEvent.currentTarget,
                          event,
                          spellName(report, event.spellId),
                        )
                      }
                      onBlur={() => timelineHoverRef.current?.hide()}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        timelineHoverRef.current?.hide();
                        setFocusedEvent(event);
                        setLaneDetail({
                          kind: "incidents",
                          time: event.t,
                        });
                      }}
                      key={`${event.t}-${event.kind}-${index}`}
                    >
                      {EVENT_META[event.kind].short}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {laneDetailModel ? (
            <section
              className={`lane-detail-panel tone-${laneDetailModel.tone}`}
              id="lane-detail"
              aria-live="polite"
            >
              <div className="lane-detail-heading">
                <span className="lane-detail-mark">轴</span>
                <div>
                  <small>{laneDetailModel.eyebrow}</small>
                  <h4>{laneDetailModel.title}</h4>
                  <p>{laneDetailModel.description}</p>
                </div>
                <button
                  type="button"
                  aria-label="关闭轨道详情"
                  onClick={() => setLaneDetail(null)}
                >
                  ×
                </button>
              </div>

              <div className="lane-detail-stats">
                {laneDetailModel.stats.map((stat) => (
                  <article key={stat.label}>
                    <small>{stat.label}</small>
                    <strong>{stat.value}</strong>
                    <span>{stat.note}</span>
                  </article>
                ))}
              </div>

              <div className="lane-detail-entries">
                <div className="lane-detail-entries-heading">
                  <strong>轨道明细</strong>
                  <span>
                    {laneDetailModel.entries.length
                      ? `${laneDetailModel.entries.length} 条显示`
                      : "当前区间没有事件"}
                  </span>
                </div>
                {laneDetailModel.entries.length ? (
                  <div className="lane-detail-entry-list">
                    {laneDetailModel.entries.map((entry) => (
                      <button
                        type="button"
                        onClick={() => selectLaneDetailEntry(entry)}
                        key={entry.key}
                      >
                        <span>
                          <strong>{entry.title}</strong>
                          <small>{entry.meta}</small>
                        </span>
                        <b>{entry.value ?? "查看"}</b>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="lane-detail-empty">
                    这条轨道在当前选择范围内没有可展开的数据。
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {personalAuras.length > 7 || targetDebuffs.length > 7 ? (
            <button
              className="replay-expand-auras"
              type="button"
              onClick={() => setShowAllAuras((value) => !value)}
            >
              {showAllAuras
                ? "收起次要光环"
                : `展开全部光环（个人 ${personalAuras.length} / 目标 ${targetDebuffs.length}）`}
            </button>
          ) : null}

          <div className="event-workbench">
            <section className="event-browser">
              <div className="event-browser-heading">
                <div>
                  <span className="panel-kicker">MILLISECOND EVENTS</span>
                  <h4>逐事件明细</h4>
                </div>
                <span>{filteredEvents.length.toLocaleString("zh-CN")} 条匹配</span>
              </div>
              <div className="event-filters">
                <div className="segmented">
                  {(
                    [
                      ["all", "全部"],
                      ["output", "输出"],
                      ["healing", "治疗"],
                      ["survival", "生存"],
                      ["casts", "施法 / 控场"],
                    ] as Array<[EventFilter, string]>
                  ).map(([value, label]) => (
                    <button
                      className={filter === value ? "active" : ""}
                      type="button"
                      onClick={() => {
                        setFilter(value);
                        setEventLimit(120);
                      }}
                      key={value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  placeholder="搜索技能、目标或失败原因"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setEventLimit(120);
                  }}
                />
                <label className="periodic-toggle">
                  <input
                    type="checkbox"
                    checked={showPeriodic}
                    onChange={(event) => setShowPeriodic(event.target.checked)}
                  />
                  <span>显示周期事件</span>
                </label>
              </div>

              <div className="event-table" role="table" aria-label="逐事件战斗日志">
                <div className="event-table-head" role="row">
                  <span role="columnheader">时间 / 类型</span>
                  <span role="columnheader">技能</span>
                  <span role="columnheader">目标</span>
                  <span role="columnheader">数值</span>
                  <span role="columnheader">Boss 血量</span>
                </div>
                <div className="event-table-body">
                  {filteredEvents.slice(0, eventLimit).map((event, index) => {
                    const health = targetId
                      ? getEventHealth(event, targetId, healthSamples)
                      : undefined;
                    const meta = EVENT_META[event.kind];
                    return (
                      <button
                        className={`event-row tone-${meta.tone} ${detailEvent === event ? "selected" : ""}`}
                        type="button"
                        role="row"
                        onClick={() => setFocusedEvent(event)}
                        key={`${event.t}-${event.kind}-${event.spellId}-${index}`}
                      >
                        <span className="event-time-cell" role="cell">
                          <b>{formatOffset(event.t, true)}</b>
                          <small>{meta.label}</small>
                        </span>
                        <span className="event-spell-cell" role="cell">
                          <i>{meta.short}</i>
                          <span>
                            <strong>{spellName(report, event.spellId)}</strong>
                            <small>
                              {eventOutcomeLabels(event).join(" · ") ||
                                (event.extraSpellId
                                  ? `关联：${spellName(report, event.extraSpellId)}`
                                  : [
                                      event.pet ? "宠物" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") ||
                                    "直接事件")}
                            </small>
                          </span>
                        </span>
                        <span className="event-target-cell" role="cell">
                          <strong>{unitName(report, event.targetId)}</strong>
                          <small>
                            {event.sourceUnitId
                              ? `来源：${unitName(report, event.sourceUnitId)}`
                              : "系统事件"}
                          </small>
                        </span>
                        <span className="event-value-cell" role="cell">
                          <strong>
                            {event.amount !== undefined
                              ? formatCompact(event.amount)
                              : "—"}
                          </strong>
                          <small>
                            {event.overAmount
                              ? `过量 ${formatCompact(event.overAmount)}`
                              : event.absorbed
                                ? `吸收 ${formatCompact(event.absorbed)}`
                                : event.blocked
                                  ? `格挡 ${formatCompact(event.blocked)}`
                                  : " "}
                          </small>
                        </span>
                        <span className="event-health-cell" role="cell">
                          {health ? (
                            <>
                              <strong>
                                {formatPercent(
                                  (health.hp / Math.max(1, health.maxHp)) * 100,
                                )}
                              </strong>
                              <small>
                                {health.exact
                                  ? "本事件快照"
                                  : `邻近 ${health.delta >= 0 ? "+" : ""}${(
                                      health.delta / 1000
                                    ).toFixed(1)}s`}
                              </small>
                            </>
                          ) : (
                            <strong>—</strong>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredEvents.length > eventLimit ? (
                <button
                  className="load-more-events"
                  type="button"
                  onClick={() => setEventLimit((value) => value + 250)}
                >
                  再加载 {Math.min(250, filteredEvents.length - eventLimit)} 条
                </button>
              ) : null}
            </section>

            <aside className="event-inspector">
              <div className="event-inspector-heading">
                <span className="panel-kicker">EVENT INSPECTOR</span>
                <h4>事件现场</h4>
              </div>
              {detailEvent ? (
                <>
                  <div className={`inspector-event tone-${EVENT_META[detailEvent.kind].tone}`}>
                    <span>{EVENT_META[detailEvent.kind].short}</span>
                    <div>
                      <small>{formatOffset(detailEvent.t, true)}</small>
                      <strong>{spellName(report, detailEvent.spellId)}</strong>
                      <p>
                        {unitName(report, detailEvent.sourceUnitId)} →{" "}
                        {unitName(report, detailEvent.targetId)}
                      </p>
                    </div>
                  </div>

                  <dl className="inspector-values">
                    <div>
                      <dt>有效数值</dt>
                      <dd>
                        {detailEvent.amount !== undefined
                          ? formatNumber(detailEvent.amount)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>未减免 / 原始量</dt>
                      <dd>
                        {detailEvent.rawAmount !== undefined
                          ? formatNumber(detailEvent.rawAmount)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>过量 / 过杀</dt>
                      <dd>{formatNumber(detailEvent.overAmount ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>吸收</dt>
                      <dd>{formatNumber(detailEvent.absorbed ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>格挡 / 抵抗</dt>
                      <dd>
                        {formatNumber(
                          (detailEvent.blocked ?? 0) +
                            (detailEvent.resisted ?? 0),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>事件属性</dt>
                      <dd>
                        {[
                          detailEvent.missType
                            ? missTypeLabel(detailEvent.missType)
                            : "",
                          detailEvent.critical ? "暴击" : "",
                          detailEvent.glancing ? "偏斜攻击" : "",
                          detailEvent.crushing ? "碾压" : "",
                          detailEvent.periodic ? "周期" : "",
                          detailEvent.pet ? "宠物" : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || "普通"}
                      </dd>
                    </div>
                  </dl>

                  <div className="inspector-health">
                    <span>当时 {unitName(report, targetId)} 血量</span>
                    {detailHealth ? (
                      <>
                        <strong>
                          {formatPercent(
                            (detailHealth.hp /
                              Math.max(1, detailHealth.maxHp)) *
                              100,
                          )}
                        </strong>
                        <div>
                          <i
                            style={{
                              width: `${(detailHealth.hp / Math.max(1, detailHealth.maxHp)) * 100}%`,
                            }}
                          />
                        </div>
                        <small>
                          {formatNumber(detailHealth.hp)} /{" "}
                          {formatNumber(detailHealth.maxHp)} ·{" "}
                          {detailHealth.exact
                            ? "本事件单位快照"
                            : `取邻近 ${detailHealth.delta >= 0 ? "+" : ""}${(
                                detailHealth.delta / 1000
                              ).toFixed(1)} 秒快照`}
                        </small>
                      </>
                    ) : (
                      <p>该段日志没有目标血量快照，页面不会伪造百分比。</p>
                    )}
                  </div>

                  <div className="inspector-auras">
                    <div>
                      <span>角色身上 Buff</span>
                      <p>
                        {activePersonalAuras.length
                          ? activePersonalAuras
                              .slice(0, 12)
                              .map((aura) => aura.name)
                              .join(" · ")
                          : "该时间点未记录到个人 Buff"}
                      </p>
                    </div>
                    <div>
                      <span>目标身上 Debuff</span>
                      <p>
                        {activeTargetDebuffs.length
                          ? activeTargetDebuffs
                              .slice(0, 12)
                              .map((aura) => aura.name)
                              .join(" · ")
                          : "该时间点未记录到目标 Debuff"}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="inspector-empty">
                  点击左侧任意事件查看现场数据。
                </div>
              )}
            </aside>
          </div>

          <TimelineHoverLayer
            ref={timelineHoverRef}
            bossName={unitName(report, targetId)}
          />

          <div className="replay-footnote">
            <span>数据边界</span>
            <p>
              “本事件快照”来自高级日志原始单位快照；“邻近快照”用于没有直接血量字段的施法事件，并明确标出时间差。技能分类和常见爆发/减伤
              Buff 识别属于通用规则，可结合职业后续继续精细化。
            </p>
          </div>
        </>
      )}
    </section>
  );
}

export default memo(CombatReplay);
