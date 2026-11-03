"use client";

import {
  buildLocalComparisonProfile,
  comparePlayerProfiles,
  isSameBoss,
  localizeComparisonProfile,
  localPlayerLabel,
  type ComparisonInsightKind,
  type ComparisonProfile,
} from "./lib/player-comparison";
import type { CombatReport } from "./lib/combat-log";
import { useMemo, useState } from "react";

interface PlayerComparisonProps {
  report: CombatReport;
  selectedPlayerId: string;
}

interface CompareApiResponse {
  profile?: ComparisonProfile;
  error?: string;
  code?: string;
  resolved?: {
    reportCode: string;
    reportTitle: string;
    fightId: number;
    bossName: string;
    playerId: number;
    playerName: string;
    eventCount: number;
  };
}

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});

const compactFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const INSIGHT_LABELS: Record<ComparisonInsightKind, string> = {
  execution: "可优化操作",
  variance: "暴击 / 触发方差",
  context: "战斗环境",
};

function formatNumber(value: number): string {
  return numberFormatter.format(Math.round(value * 10) / 10);
}

function formatCompact(value: number): string {
  return compactFormatter.format(Math.round(value));
}

function formatPercent(value: number, signed = false): string {
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)}s`;
}

function participantIds(report: CombatReport, fightId: string): Set<string> {
  const fight = report.fights.find((item) => item.id === fightId);
  const ids = new Set<string>();
  if (!fight) return ids;
  Object.keys(fight.actorTargets).forEach((id) => ids.add(id));
  Object.keys(fight.actorHeals ?? {}).forEach((id) => ids.add(id));
  for (const event of fight.timeline?.events ?? []) {
    if (event.sourceActorId) ids.add(event.sourceActorId);
  }
  return ids;
}

function spellIconUrl(id: string): string | undefined {
  const spellId = Number(id);
  return Number.isFinite(spellId)
    ? `/api/spell-icon?spellId=${encodeURIComponent(String(spellId))}`
    : undefined;
}

export default function PlayerComparison({
  report,
  selectedPlayerId,
}: PlayerComparisonProps) {
  const [fightOverride, setFightOverride] = useState("");
  const [playerOverride, setPlayerOverride] = useState("");
  const [wclUrl, setWclUrl] = useState("");
  const [actorName, setActorName] = useState("");
  const [benchmark, setBenchmark] = useState<ComparisonProfile | null>(null);
  const [resolvedTitle, setResolvedTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fightId = report.fights.some((fight) => fight.id === fightOverride)
    ? fightOverride
    : report.fights[0]?.id ?? "";
  const currentFight = report.fights.find((fight) => fight.id === fightId);
  const participants = useMemo(() => participantIds(report, fightId), [fightId, report]);
  const players = useMemo(() => {
    const matched = report.players.filter((player) => participants.has(player.id));
    return matched.length ? matched : report.players;
  }, [participants, report.players]);
  const playerId = players.some((player) => player.id === playerOverride)
    ? playerOverride
    : players.some((player) => player.id === selectedPlayerId)
      ? selectedPlayerId
      : players[0]?.id ?? "";

  const localProfile = useMemo(() => {
    if (!fightId || !playerId) return null;
    try {
      return buildLocalComparisonProfile(report, fightId, playerId);
    } catch {
      return null;
    }
  }, [fightId, playerId, report]);

  const comparison = useMemo(
    () =>
      localProfile && benchmark
        ? comparePlayerProfiles(localProfile, benchmark)
        : null,
    [benchmark, localProfile],
  );

  async function requestComparison(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localProfile) {
      setError("请先选择本地 Boss 和角色");
      return;
    }
    if (!wclUrl.trim()) {
      setError("请粘贴 WCL 报告战斗链接或角色链接");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/wcl/compare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: wclUrl.trim(),
          actorName: actorName.trim() || undefined,
          bossName: localProfile.bossName,
          encounterId: localProfile.encounterId,
        }),
      });
      const payload = (await response.json()) as CompareApiResponse;
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error || `WCL 请求失败（${response.status}）`);
      }
      const localizedProfile = localizeComparisonProfile(
        payload.profile,
        report.spellNames,
      );
      setBenchmark(
        isSameBoss(localProfile, localizedProfile)
          ? { ...localizedProfile, bossName: localProfile.bossName }
          : localizedProfile,
      );
      setResolvedTitle(
        payload.resolved
          ? `${payload.resolved.reportTitle} · Fight ${payload.resolved.fightId}`
          : `Report ${payload.profile.reportCode ?? ""}`,
      );
    } catch (reason) {
      setBenchmark(null);
      setResolvedTitle("");
      setError(reason instanceof Error ? reason.message : "WCL 对比请求失败");
    } finally {
      setLoading(false);
    }
  }

  const topAbilityRows = comparison?.abilityRows.slice(0, 14) ?? [];
  const maxAbilityAmount = Math.max(
    1,
    ...topAbilityRows.flatMap((row) => [row.localAmount, row.benchmarkAmount]),
  );
  const localMetricAmount = comparison
    ? comparison.primaryMetric === "damage"
      ? localProfile?.totalDamage ?? 0
      : (localProfile?.totalHealing ?? 0) + (localProfile?.totalAbsorb ?? 0)
    : 0;
  const benchmarkMetricAmount = comparison
    ? comparison.primaryMetric === "damage"
      ? benchmark?.totalDamage ?? 0
      : (benchmark?.totalHealing ?? 0) + (benchmark?.totalAbsorb ?? 0)
    : 0;
  const executionInsightCount =
    comparison?.insights.filter((insight) => insight.kind === "execution").length ?? 0;
  const varianceInsightCount =
    comparison?.insights.filter((insight) => insight.kind === "variance").length ?? 0;
  const contextInsightCount =
    comparison?.insights.filter((insight) => insight.kind === "context").length ?? 0;
  const gapScale = comparison
    ? Math.min(100, Math.max(4, Math.abs(comparison.relativeGap) * 100))
    : 4;

  return (
    <section className="comparison-panel panel" id="compare" aria-labelledby="compare-title">
      <div className="comparison-heading">
        <div>
          <span className="panel-kicker">PLAYER BENCHMARK · OFFICIAL WCL API</span>
          <h3 id="compare-title">同 Boss 角色对比</h3>
          <p>
            本地日志对照一场公开 WCL：先找可复现的操作差距，再隔离暴击、触发与团队速度噪声。
          </p>
        </div>
        <span className="comparison-privacy">只发送报告链接与匹配条件，不发送本地日志</span>
      </div>

      <form className="comparison-form" onSubmit={requestComparison}>
        <label>
          <span>本地 Boss 战</span>
          <select value={fightId} onChange={(event) => setFightOverride(event.target.value)}>
            {report.fights.map((fight, index) => (
              <option value={fight.id} key={fight.id}>
                #{index + 1} {fight.name} · {formatSeconds(fight.durationMs)} · {fight.success ? "击杀" : "失败"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>本地角色</span>
          <select value={playerId} onChange={(event) => setPlayerOverride(event.target.value)}>
            {players.map((player) => (
              <option value={player.id} key={player.id}>
                {localPlayerLabel(player)}
              </option>
            ))}
          </select>
        </label>
        <label className="comparison-url-field">
          <span>WCL 战斗链接 / 角色链接</span>
          <input
            type="url"
            value={wclUrl}
            onChange={(event) => setWclUrl(event.target.value)}
            placeholder="https://cn.titan.warcraftlogs.com/reports/...?...fight=7&source=51"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label>
          <span>对比角色名（可选）</span>
          <input
            type="text"
            value={actorName}
            onChange={(event) => setActorName(event.target.value)}
            placeholder="链接没有 source 时填写"
            maxLength={64}
            autoComplete="off"
          />
        </label>
        <button className="comparison-submit" type="submit" disabled={loading || !currentFight}>
          {loading ? <span className="comparison-spinner" aria-hidden="true" /> : <span aria-hidden="true">↗</span>}
          {loading ? "正在读取 WCL…" : "开始公平对比"}
        </button>
      </form>

      <div className="comparison-form-note">
        <span>推荐直接粘贴带 fight 与 source 参数的事件页链接；角色主页会在近期公开报告中自动寻找同 Boss。</span>
        <a href="https://www.warcraftlogs.com/api/docs" target="_blank" rel="noreferrer">
          官方 API 说明
        </a>
      </div>

      {error ? (
        <div className="comparison-error" role="alert">
          <span>!</span>
          <div>
            <strong>暂时无法读取这场 WCL</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {comparison && localProfile && benchmark ? (
        <div className="comparison-results">
          <div className="comparison-matchbar">
            <div>
              <span className={comparison.sameBoss ? "is-match" : "is-warning"}>
                {comparison.sameBoss ? "同 Boss" : "Boss 不一致"}
              </span>
              <span
                className={
                  comparison.sameSpecialization === false ? "is-warning" : "is-match"
                }
              >
                {comparison.sameSpecialization === false
                  ? "专精不一致"
                  : benchmark.specialization || benchmark.className || "专精待核对"}
              </span>
            </div>
            <p>
              <strong>{localProfile.playerName}</strong> vs <strong>{benchmark.playerName}</strong>
              <small>{localProfile.bossName} · {resolvedTitle}</small>
            </p>
            {benchmark.reportUrl ? (
              <a href={benchmark.reportUrl} target="_blank" rel="noreferrer">
                打开原始 WCL ↗
              </a>
            ) : null}
          </div>

          <div className="comparison-result-hero">
            <div className="comparison-gap-display">
              <span>PERFORMANCE DELTA</span>
              <strong>{formatPercent(comparison.relativeGap, true)}</strong>
              <p>
                {comparison.relativeGap > 0
                  ? `距离 ${benchmark.playerName} 的单场每秒表现`
                  : `当前单场每秒表现领先 ${benchmark.playerName}`}
              </p>
            </div>
            <div className="comparison-gap-visual" aria-label={`每秒差距 ${formatPercent(comparison.relativeGap, true)}`}>
              <div className="comparison-gap-labels">
                <span><b>{localProfile.playerName}</b>{formatNumber(comparison.localPerSecond)}</span>
                <span><b>{benchmark.playerName}</b>{formatNumber(comparison.benchmarkPerSecond)}</span>
              </div>
              <div className="comparison-gap-track">
                <i style={{ width: `${gapScale}%` }} />
                <span style={{ left: `${Math.min(96, gapScale)}%` }} />
              </div>
              <p>这条差距会在下方被拆成操作、随机方差和战斗环境，不直接等同于手法。</p>
            </div>
            <div className="comparison-signal-stack">
              <article>
                <span className="signal-execution">可练</span>
                <strong>{executionInsightCount}</strong>
                <small>条操作线索</small>
              </article>
              <article>
                <span className="signal-variance">方差</span>
                <strong>{varianceInsightCount}</strong>
                <small>条随机信号</small>
              </article>
              <article>
                <span className="signal-context">环境</span>
                <strong>{contextInsightCount}</strong>
                <small>条场景差异</small>
              </article>
            </div>
          </div>

          <div className="comparison-overview">
            <article>
              <span>{comparison.primaryMetric === "damage" ? "DPS" : "HPS"}</span>
              <strong>{formatNumber(comparison.localPerSecond)}</strong>
              <small>{localProfile.playerName}</small>
            </article>
            <article className="benchmark">
              <span>WCL 基准</span>
              <strong>{formatNumber(comparison.benchmarkPerSecond)}</strong>
              <small>{benchmark.playerName}</small>
            </article>
            <article className={comparison.perSecondDelta > 0 ? "gap" : "ahead"}>
              <span>每秒差距</span>
              <strong>
                {comparison.perSecondDelta > 0 ? "+" : ""}
                {formatNumber(comparison.perSecondDelta)}
              </strong>
              <small>{formatPercent(comparison.relativeGap, true)}</small>
            </article>
            <article>
              <span>{comparison.primaryMetric === "damage" ? "总伤害" : "治疗 + 吸收"}</span>
              <strong>{formatCompact(localMetricAmount)}</strong>
              <small>基准 {formatCompact(benchmarkMetricAmount)}</small>
            </article>
            <article>
              <span>战斗时长</span>
              <strong>{formatSeconds(localProfile.durationMs)}</strong>
              <small>基准 {formatSeconds(benchmark.durationMs)}</small>
            </article>
            <article>
              <span>活跃区间</span>
              <strong>{formatPercent(comparison.localActivePercent)}</strong>
              <small>基准 {formatPercent(comparison.benchmarkActivePercent)}</small>
            </article>
          </div>

          <div className="comparison-analysis-grid">
            <section className="comparison-insights" aria-labelledby="comparison-insights-title">
              <div className="comparison-subheading">
                <div>
                  <span>FAIR GAP BREAKDOWN</span>
                  <h4 id="comparison-insights-title">差距拆解与优化顺序</h4>
                </div>
                <small>单场结论 · 建议用 5–10 场中位数复核</small>
              </div>
              <div className="comparison-insight-list">
                {comparison.insights.map((insight, index) => (
                  <article className={`insight-${insight.kind}`} key={`${insight.title}-${index}`}>
                    <span className="comparison-insight-index">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>{INSIGHT_LABELS[insight.kind]} · 置信度 {insight.confidence}</small>
                      <h5>{insight.title}</h5>
                      <p>{insight.detail}</p>
                      <em>{insight.evidence}</em>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="comparison-method">
              <div>
                <span>分析原则</span>
                <h4>先看“按了什么”，再看“打了多少”。</h4>
              </div>
              <ol>
                <li><b>01</b><span><strong>同场景校验</strong><small>Boss、专精、击杀 / 失败、时长</small></span></li>
                <li><b>02</b><span><strong>操作机会</strong><small>施法次数、首发、GCD 空窗、斩杀</small></span></li>
                <li><b>03</b><span><strong>爆发对齐</strong><small>主动技能、饰品与 Buff 覆盖</small></span></li>
                <li><b>04</b><span><strong>隔离噪声</strong><small>暴击、触发、装备与团队击杀速度</small></span></li>
              </ol>
              <p>WCL 侧总量直接读取官方 Damage Done / Healing 表；事件用于还原施法与状态。</p>
            </aside>
          </div>

          <section className="comparison-abilities" aria-labelledby="comparison-abilities-title">
            <div className="comparison-subheading">
              <div>
                <span>ABILITY DELTA</span>
                <h4 id="comparison-abilities-title">详细技能差距</h4>
              </div>
              <small>伤害 / 治疗总量 · 施放 · 事件暴击率</small>
            </div>
            <div className="comparison-ability-table" role="table" aria-label="技能对比">
              <div className="comparison-ability-head" role="row">
                <span role="columnheader">技能</span>
                <span role="columnheader">本地总量</span>
                <span role="columnheader">WCL 基准</span>
                <span role="columnheader">差距</span>
                <span role="columnheader">施放</span>
                <span role="columnheader">暴击事件</span>
              </div>
              {topAbilityRows.map((row) => {
                const icon = spellIconUrl(row.id);
                return (
                  <div className="comparison-ability-row" role="row" key={row.id}>
                    <div className="comparison-ability-name" role="cell">
                      <span className="comparison-ability-icon">
                        {icon ? (
                          <i style={{ backgroundImage: `url(${icon})` }} aria-hidden="true" />
                        ) : null}
                        <b>{row.name.slice(0, 1)}</b>
                      </span>
                      <p><strong>{row.name}</strong><small>#{row.id}</small></p>
                    </div>
                    <div className="comparison-amount-cell" role="cell">
                      <strong>{formatCompact(row.localAmount)}</strong>
                      <span><i style={{ width: `${(row.localAmount / maxAbilityAmount) * 100}%` }} /></span>
                    </div>
                    <div className="comparison-amount-cell benchmark" role="cell">
                      <strong>{formatCompact(row.benchmarkAmount)}</strong>
                      <span><i style={{ width: `${(row.benchmarkAmount / maxAbilityAmount) * 100}%` }} /></span>
                    </div>
                    <strong className={row.delta > 0 ? "ability-gap" : "ability-ahead"} role="cell">
                      {row.delta > 0 ? "+" : ""}{formatCompact(row.delta)}
                    </strong>
                    <span role="cell">{row.localCasts} / {row.benchmarkCasts}</span>
                    <span role="cell">
                      {formatPercent(row.localCritRate)} / {formatPercent(row.benchmarkCritRate)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="comparison-caveat">
            <span>≠</span>
            <p>
              <strong>总差距不等于手法差距。</strong>
              短战斗中暴击与饰品触发可能决定数万伤害；网页只把有事件证据、可重复执行的部分列为优化项。
            </p>
          </div>
        </div>
      ) : (
        <div className="comparison-empty">
          <div className="comparison-empty-visual" aria-hidden="true">
            <span>本地</span><i /><b>VS</b><i /><span>WCL</span>
          </div>
          <div>
            <strong>选择本地战斗，再粘贴一场优秀 WCL</strong>
            <p>支持带 fight / source 的报告链接，也支持角色主页自动搜索近期同 Boss 战斗。</p>
          </div>
        </div>
      )}
    </section>
  );
}
