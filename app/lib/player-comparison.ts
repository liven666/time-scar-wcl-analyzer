import type {
  CombatReport,
  CombatTimelineEvent,
  FightResult,
  PlayerMeta,
} from "./combat-log";
import {
  isBossNameEquivalent,
  localizeBossName,
  localizeSpellName,
} from "./wow-localization";

export type ComparisonSource = "local" | "wcl";
export type ComparisonPrimaryMetric = "damage" | "healing";
export type ComparisonInsightKind = "execution" | "variance" | "context";

export interface ComparisonAbility {
  id: string;
  name: string;
  damage: number;
  healing: number;
  absorb: number;
  casts: number;
  landed: number;
  critical: number;
  misses: number;
  blocked: number;
  dodged: number;
  parried: number;
  glanced: number;
  firstCastMs?: number;
  lastCastMs?: number;
}

export interface ComparisonAura {
  id: string;
  name: string;
  uptimeMs: number;
  applications: number;
}

export interface ComparisonProfile {
  version: 1;
  source: ComparisonSource;
  reportCode?: string;
  reportUrl?: string;
  fightId: string;
  encounterId?: string;
  bossName: string;
  playerId: string;
  playerName: string;
  className?: string;
  specialization?: string;
  role?: string;
  kill: boolean;
  durationMs: number;
  activeMs: number;
  totalDamage: number;
  totalHealing: number;
  totalAbsorb: number;
  abilities: ComparisonAbility[];
  auras: ComparisonAura[];
  actionTimestampsMs: number[];
}

export interface ComparisonAbilityRow {
  id: string;
  name: string;
  localAmount: number;
  benchmarkAmount: number;
  delta: number;
  localCasts: number;
  benchmarkCasts: number;
  localCritRate: number;
  benchmarkCritRate: number;
  localFirstCastMs?: number;
  benchmarkFirstCastMs?: number;
}

export interface ComparisonInsight {
  kind: ComparisonInsightKind;
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  evidence: string;
  confidence: "高" | "中" | "低";
}

export interface PlayerComparisonResult {
  sameBoss: boolean;
  sameClass: boolean | null;
  sameSpecialization: boolean | null;
  primaryMetric: ComparisonPrimaryMetric;
  localPerSecond: number;
  benchmarkPerSecond: number;
  perSecondDelta: number;
  amountDelta: number;
  relativeGap: number;
  localActivePercent: number;
  benchmarkActivePercent: number;
  localLongGapMs: number;
  benchmarkLongGapMs: number;
  abilityRows: ComparisonAbilityRow[];
  insights: ComparisonInsight[];
}

export interface WclProfileMetadata {
  reportCode: string;
  reportUrl: string;
  fightId: number;
  encounterId?: number;
  bossName: string;
  fightStartMs: number;
  fightEndMs: number;
  playerId: number;
  playerName: string;
  className?: string;
  specialization?: string;
  role?: string;
  kill: boolean;
}

type UnknownRecord = Record<string, unknown>;

const PASSIVE_ABILITY_PATTERN =
  /^(melee|attack|auto attack|近战|普通攻击|自动攻击)$/i;

function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function eventAbilityId(event: UnknownRecord): string {
  const nestedAbility =
    event.ability && typeof event.ability === "object"
      ? (event.ability as UnknownRecord)
      : undefined;
  const value =
    event.abilityGameID ??
    event.abilityID ??
    nestedAbility?.gameID ??
    nestedAbility?.id ??
    0;
  return String(value);
}

function eventTimestamp(event: UnknownRecord, fightStartMs: number): number {
  return Math.max(0, finiteNumber(event.timestamp) - fightStartMs);
}

function eventType(event: UnknownRecord): string {
  return String(event.type ?? "").toLowerCase().replace(/[ _-]/g, "");
}

function createAbility(id: string, name: string): ComparisonAbility {
  return {
    id,
    name,
    damage: 0,
    healing: 0,
    absorb: 0,
    casts: 0,
    landed: 0,
    critical: 0,
    misses: 0,
    blocked: 0,
    dodged: 0,
    parried: 0,
    glanced: 0,
  };
}

function ensureAbility(
  abilities: Map<string, ComparisonAbility>,
  id: string,
  name: string,
): ComparisonAbility {
  const current = abilities.get(id);
  if (current) {
    if (/^技能 \d+$/.test(current.name) && name) current.name = name;
    return current;
  }
  const ability = createAbility(id, name || `技能 ${id}`);
  abilities.set(id, ability);
  return ability;
}

function timelineAbilityName(report: CombatReport, spellId: number): string {
  if (spellId === 0) return "近战";
  return report.spellNames?.[String(spellId)] ?? `技能 ${spellId}`;
}

function recordTimelineOutcome(
  ability: ComparisonAbility,
  event: CombatTimelineEvent,
): void {
  if (event.kind === "damage" || event.kind === "heal" || event.kind === "absorb") {
    ability.landed += 1;
  }
  if (event.critical) ability.critical += 1;
  if (event.glancing) ability.glanced += 1;
  if ((event.blocked ?? 0) > 0) ability.blocked += 1;
  if (event.kind === "miss") {
    ability.misses += 1;
    const miss = (event.missType ?? "").toUpperCase();
    if (miss.includes("DODGE") || miss.includes("躲闪")) ability.dodged += 1;
    if (miss.includes("PARRY") || miss.includes("招架")) ability.parried += 1;
    if (miss.includes("BLOCK") || miss.includes("格挡")) ability.blocked += 1;
  }
}

function localFightDamage(fight: FightResult, playerId: string): number {
  return Object.values(fight.actorTargets[playerId] ?? {}).reduce(
    (sum, amount) => sum + amount,
    0,
  );
}

function localFightHealing(fight: FightResult, playerId: string): number {
  return Object.values(fight.actorHeals?.[playerId] ?? {}).reduce(
    (sum, amount) => sum + amount,
    0,
  );
}

function overlapDuration(start: number, end: number, durationMs: number): number {
  return Math.max(0, Math.min(durationMs, end) - Math.max(0, start));
}

export function buildLocalComparisonProfile(
  report: CombatReport,
  fightId: string,
  playerId: string,
): ComparisonProfile {
  const fight = report.fights.find((item) => item.id === fightId);
  if (!fight) throw new Error("没有找到所选本地 Boss 战");
  const player = report.players.find((item) => item.id === playerId);
  if (!player) throw new Error("没有找到所选本地角色");

  const abilities = new Map<string, ComparisonAbility>();
  const timelineEvents = fight.timeline?.events ?? [];
  const damageAmounts = fight.actorSpellTargets?.[player.id] ?? {};
  for (const [spellId, targets] of Object.entries(damageAmounts)) {
    const ability = ensureAbility(
      abilities,
      spellId,
      timelineAbilityName(report, Number(spellId)),
    );
    ability.damage = Object.values(targets).reduce(
      (sum, amount) => sum + amount,
      0,
    );
  }
  for (const [spellId, healing] of Object.entries(
    fight.actorHeals?.[player.id] ?? {},
  )) {
    ensureAbility(
      abilities,
      spellId,
      timelineAbilityName(report, Number(spellId)),
    ).healing = healing;
  }

  const actionTimestampsMs: number[] = [];
  const activityTimestamps: number[] = [];
  const eventDamageFallback = new Map<string, number>();
  const eventHealingFallback = new Map<string, number>();
  let totalAbsorb = 0;

  for (const event of timelineEvents) {
    if (event.sourceActorId !== player.id) continue;
    const id = String(event.spellId);
    const ability = ensureAbility(
      abilities,
      id,
      timelineAbilityName(report, event.spellId),
    );
    recordTimelineOutcome(ability, event);

    if (event.kind === "damage") {
      eventDamageFallback.set(
        id,
        (eventDamageFallback.get(id) ?? 0) + (event.amount ?? 0),
      );
    } else if (event.kind === "heal") {
      eventHealingFallback.set(
        id,
        (eventHealingFallback.get(id) ?? 0) + (event.amount ?? 0),
      );
    } else if (event.kind === "absorb") {
      ability.absorb += event.amount ?? 0;
      totalAbsorb += event.amount ?? 0;
    }

    const isOwnUnit = !event.sourceUnitId || event.sourceUnitId === player.id;
    if (event.kind === "cast" && isOwnUnit) {
      ability.casts += 1;
      ability.firstCastMs = Math.min(ability.firstCastMs ?? event.t, event.t);
      ability.lastCastMs = Math.max(ability.lastCastMs ?? event.t, event.t);
      actionTimestampsMs.push(event.t);
    }
    if (
      isOwnUnit &&
      (event.kind === "cast" ||
        event.kind === "damage" ||
        event.kind === "heal" ||
        event.kind === "absorb")
    ) {
      activityTimestamps.push(event.t);
    }
  }

  for (const [id, amount] of eventDamageFallback) {
    const ability = abilities.get(id);
    if (ability && ability.damage === 0) ability.damage = amount;
  }
  for (const [id, amount] of eventHealingFallback) {
    const ability = abilities.get(id);
    if (ability && ability.healing === 0) ability.healing = amount;
  }

  const auras = new Map<string, ComparisonAura>();
  for (const aura of fight.timeline?.auras ?? []) {
    if (aura.targetId !== player.id || aura.auraType !== "BUFF") continue;
    const id = String(aura.spellId);
    const current = auras.get(id) ?? {
      id,
      name: timelineAbilityName(report, aura.spellId),
      uptimeMs: 0,
      applications: 0,
    };
    current.uptimeMs += overlapDuration(aura.start, aura.end, fight.durationMs);
    current.applications += 1;
    auras.set(id, current);
  }

  const firstActivity = activityTimestamps.length
    ? Math.min(...activityTimestamps)
    : 0;
  const lastActivity = activityTimestamps.length
    ? Math.max(...activityTimestamps)
    : 0;

  return {
    version: 1,
    source: "local",
    fightId: fight.id,
    encounterId: fight.encounterId,
    bossName: fight.name,
    playerId: player.id,
    playerName: player.name,
    className: player.className,
    specialization: player.specialization,
    role: player.role,
    kill: fight.success,
    durationMs: fight.durationMs,
    activeMs: Math.min(
      fight.durationMs,
      Math.max(0, lastActivity - firstActivity),
    ),
    totalDamage: localFightDamage(fight, player.id),
    totalHealing: localFightHealing(fight, player.id),
    totalAbsorb,
    abilities: [...abilities.values()].sort(
      (a, b) =>
        b.damage + b.healing + b.absorb - (a.damage + a.healing + a.absorb),
    ),
    auras: [...auras.values()].sort((a, b) => b.uptimeMs - a.uptimeMs),
    actionTimestampsMs: [...new Set(actionTimestampsMs)].sort((a, b) => a - b),
  };
}

function hitOutcome(event: UnknownRecord): {
  critical: boolean;
  miss: boolean;
  block: boolean;
  dodge: boolean;
  parry: boolean;
  glance: boolean;
} {
  const hitType = finiteNumber(event.hitType, -1);
  const missType = String(event.missType ?? event.result ?? "").toUpperCase();
  const isMissResult =
    /^(MISS|DODGE|PARRY|IMMUNE|DEFLECT|REFLECT|MISFIRE|EVADE|RESIST|BLOCK)$/.test(
      missType,
    );
  return {
    critical: Boolean(event.critical) || hitType === 2,
    miss: isMissResult,
    block: finiteNumber(event.blocked) > 0 || missType === "BLOCK",
    dodge: missType === "DODGE",
    parry: missType === "PARRY",
    glance: Boolean(event.glancing),
  };
}

function wclAbilityName(
  event: UnknownRecord,
  abilityNames: Record<string, string>,
  id: string,
): string {
  const nestedAbility =
    event.ability && typeof event.ability === "object"
      ? (event.ability as UnknownRecord)
      : undefined;
  const nestedName = nestedAbility?.name;
  const rawName =
    typeof nestedName === "string" && nestedName
      ? nestedName
      : abilityNames[id];
  return localizeSpellName(id, rawName);
}

export function buildWclComparisonProfile(
  metadata: WclProfileMetadata,
  rawEvents: UnknownRecord[],
  abilityNames: Record<string, string>,
): ComparisonProfile {
  const durationMs = Math.max(1, metadata.fightEndMs - metadata.fightStartMs);
  const abilities = new Map<string, ComparisonAbility>();
  const actionTimestampsMs: number[] = [];
  const activityTimestamps: number[] = [];
  const activeAuras = new Map<string, { start: number; applications: number }>();
  const auras = new Map<string, ComparisonAura>();
  let totalDamage = 0;
  let totalHealing = 0;
  let totalAbsorb = 0;

  const sortedEvents = [...rawEvents].sort(
    (a, b) => finiteNumber(a.timestamp) - finiteNumber(b.timestamp),
  );
  for (const event of sortedEvents) {
    const type = eventType(event);
    const id = eventAbilityId(event);
    const time = eventTimestamp(event, metadata.fightStartMs);
    const name = wclAbilityName(event, abilityNames, id);
    const ability = ensureAbility(abilities, id, name);
    const amount = Math.max(0, finiteNumber(event.amount));
    const outcome = hitOutcome(event);

    if (type === "cast") {
      ability.casts += 1;
      ability.firstCastMs = Math.min(ability.firstCastMs ?? time, time);
      ability.lastCastMs = Math.max(ability.lastCastMs ?? time, time);
      actionTimestampsMs.push(time);
      activityTimestamps.push(time);
    } else if (type === "damage") {
      ability.damage += amount;
      ability.landed += 1;
      totalDamage += amount;
      activityTimestamps.push(time);
    } else if (type === "heal" || type === "healing") {
      ability.healing += amount;
      ability.landed += 1;
      totalHealing += amount;
      activityTimestamps.push(time);
    } else if (type === "absorbed" || type === "absorb") {
      ability.absorb += amount;
      ability.landed += 1;
      totalAbsorb += amount;
      activityTimestamps.push(time);
    } else if (type.includes("miss")) {
      ability.misses += 1;
    }

    if (outcome.critical) ability.critical += 1;
    if (outcome.block) ability.blocked += 1;
    if (outcome.dodge) ability.dodged += 1;
    if (outcome.parry) ability.parried += 1;
    if (outcome.glance) ability.glanced += 1;
    if (outcome.miss && !type.includes("miss")) ability.misses += 1;

    const targetId = String(event.targetID ?? event.targetId ?? "");
    const isSelfAura = targetId === String(metadata.playerId);
    if (!isSelfAura) continue;
    if (type === "applybuff" || type === "applybuffstack") {
      const active = activeAuras.get(id);
      if (!active) activeAuras.set(id, { start: time, applications: 1 });
      else active.applications += 1;
    } else if (type === "refreshbuff") {
      const active = activeAuras.get(id);
      if (!active) activeAuras.set(id, { start: time, applications: 1 });
    } else if (type === "removebuff" || type === "removebuffstack") {
      const active = activeAuras.get(id);
      if (!active) continue;
      const aura = auras.get(id) ?? {
        id,
        name,
        uptimeMs: 0,
        applications: 0,
      };
      aura.uptimeMs += overlapDuration(active.start, time, durationMs);
      aura.applications += active.applications;
      auras.set(id, aura);
      activeAuras.delete(id);
    }
  }

  for (const [id, active] of activeAuras) {
    const aura = auras.get(id) ?? {
      id,
      name: localizeSpellName(id, abilityNames[id]),
      uptimeMs: 0,
      applications: 0,
    };
    aura.uptimeMs += overlapDuration(active.start, durationMs, durationMs);
    aura.applications += active.applications;
    auras.set(id, aura);
  }

  const firstActivity = activityTimestamps.length
    ? Math.min(...activityTimestamps)
    : 0;
  const lastActivity = activityTimestamps.length
    ? Math.max(...activityTimestamps)
    : 0;
  return {
    version: 1,
    source: "wcl",
    reportCode: metadata.reportCode,
    reportUrl: metadata.reportUrl,
    fightId: String(metadata.fightId),
    encounterId:
      metadata.encounterId === undefined
        ? undefined
        : String(metadata.encounterId),
    bossName: localizeBossName(metadata.bossName),
    playerId: String(metadata.playerId),
    playerName: metadata.playerName,
    className: metadata.className,
    specialization: metadata.specialization,
    role: metadata.role,
    kill: metadata.kill,
    durationMs,
    activeMs: Math.min(durationMs, Math.max(0, lastActivity - firstActivity)),
    totalDamage,
    totalHealing,
    totalAbsorb,
    abilities: [...abilities.values()].sort(
      (a, b) =>
        b.damage + b.healing + b.absorb - (a.damage + a.healing + a.absorb),
    ),
    auras: [...auras.values()].sort((a, b) => b.uptimeMs - a.uptimeMs),
    actionTimestampsMs: [...new Set(actionTimestampsMs)].sort((a, b) => a - b),
  };
}

function normalizedIdentity(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·'’\-_:：()（）]/g, "")
    .replace(/高阶祭司|highpriest/g, "");
}

function canonicalClass(value: string | undefined): string {
  const identity = normalizedIdentity(value);
  const aliases: Array<[RegExp, string]> = [
    [/^(deathknight|死亡骑士|dk)$/, "deathknight"],
    [/^(druid|德鲁伊)$/, "druid"],
    [/^(hunter|猎人)$/, "hunter"],
    [/^(mage|法师)$/, "mage"],
    [/^(paladin|圣骑士|骑士)$/, "paladin"],
    [/^(priest|牧师)$/, "priest"],
    [/^(rogue|潜行者|盗贼)$/, "rogue"],
    [/^(shaman|萨满祭司|萨满)$/, "shaman"],
    [/^(warlock|术士)$/, "warlock"],
    [/^(warrior|战士)$/, "warrior"],
  ];
  return aliases.find(([pattern]) => pattern.test(identity))?.[1] ?? identity;
}

function canonicalSpecialization(value: string | undefined): string {
  const identity = normalizedIdentity(value).replace(
    /^(deathknight|死亡骑士|druid|德鲁伊|hunter|猎人|mage|法师|paladin|圣骑士|priest|牧师|rogue|潜行者|shaman|萨满祭司|warlock|术士|warrior|战士)/,
    "",
  );
  const aliases: Array<[RegExp, string]> = [
    [/^(blood|鲜血)$/, "blood"],
    [/^(frost|冰霜)$/, "frost"],
    [/^(unholy|邪恶)$/, "unholy"],
    [/^(balance|平衡)$/, "balance"],
    [/^(feral|野性战斗|野性)$/, "feral"],
    [/^(beastmastery|野兽控制|兽王)$/, "beastmastery"],
    [/^(marksmanship|射击)$/, "marksmanship"],
    [/^(survival|生存)$/, "survival"],
    [/^(arcane|奥术)$/, "arcane"],
    [/^(fire|火焰)$/, "fire"],
    [/^(holy|神圣)$/, "holy"],
    [/^(protection|防护)$/, "protection"],
    [/^(retribution|惩戒)$/, "retribution"],
    [/^(discipline|戒律)$/, "discipline"],
    [/^(shadow|暗影)$/, "shadow"],
    [/^(assassination|刺杀)$/, "assassination"],
    [/^(combat|战斗)$/, "combat"],
    [/^(subtlety|敏锐)$/, "subtlety"],
    [/^(elemental|元素)$/, "elemental"],
    [/^(enhancement|增强)$/, "enhancement"],
    [/^(restoration|恢复)$/, "restoration"],
    [/^(affliction|痛苦)$/, "affliction"],
    [/^(demonology|恶魔学识|恶魔)$/, "demonology"],
    [/^(destruction|毁灭)$/, "destruction"],
    [/^(arms|武器)$/, "arms"],
    [/^(fury|狂怒)$/, "fury"],
  ];
  return aliases.find(([pattern]) => pattern.test(identity))?.[1] ?? identity;
}

export function isSameBoss(
  local: Pick<ComparisonProfile, "encounterId" | "bossName">,
  benchmark: Pick<ComparisonProfile, "encounterId" | "bossName">,
): boolean {
  if (
    local.encounterId &&
    benchmark.encounterId &&
    local.encounterId === benchmark.encounterId
  ) {
    return true;
  }
  return isBossNameEquivalent(local.bossName, benchmark.bossName);
}

export function localizeComparisonProfile(
  profile: ComparisonProfile,
  localSpellNames?: Record<string, string>,
): ComparisonProfile {
  return {
    ...profile,
    bossName: localizeBossName(profile.bossName),
    abilities: profile.abilities.map((ability) => ({
      ...ability,
      name: localizeSpellName(ability.id, ability.name, localSpellNames),
    })),
    auras: profile.auras.map((aura) => ({
      ...aura,
      name: localizeSpellName(aura.id, aura.name, localSpellNames),
    })),
  };
}

function abilityAmount(
  ability: ComparisonAbility,
  metric: ComparisonPrimaryMetric,
): number {
  return metric === "damage"
    ? ability.damage
    : ability.healing + ability.absorb;
}

function profileAmount(
  profile: ComparisonProfile,
  metric: ComparisonPrimaryMetric,
): number {
  return metric === "damage"
    ? profile.totalDamage
    : profile.totalHealing + profile.totalAbsorb;
}

function critRate(ability: ComparisonAbility | undefined): number {
  return ability?.landed ? ability.critical / ability.landed : 0;
}

function activePercent(profile: ComparisonProfile): number {
  return profile.durationMs ? profile.activeMs / profile.durationMs : 0;
}

function longGapMs(timestamps: number[]): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let total = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 2_250) total += gap - 1_500;
  }
  return total;
}

function totalCritRate(profile: ComparisonProfile): number {
  const totals = profile.abilities.reduce(
    (value, ability) => ({
      landed: value.landed + ability.landed,
      critical: value.critical + ability.critical,
    }),
    { landed: 0, critical: 0 },
  );
  return totals.landed ? totals.critical / totals.landed : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function seconds(value: number): string {
  return `${(value / 1000).toFixed(1)} 秒`;
}

function displayName(profile: ComparisonProfile): string {
  return profile.source === "local" ? profile.playerName : `WCL ${profile.playerName}`;
}

export function comparePlayerProfiles(
  localInput: ComparisonProfile,
  benchmarkInput: ComparisonProfile,
): PlayerComparisonResult {
  // Keep the comparison core safe even when a caller passes a raw WCL profile.
  // This prevents English boss, ability and aura names from leaking into
  // same-Boss checks or generated insight copy.
  const local = localizeComparisonProfile(localInput);
  const benchmark = localizeComparisonProfile(benchmarkInput);
  const primaryMetric: ComparisonPrimaryMetric =
    local.role === "healer" ||
    local.totalHealing + local.totalAbsorb > local.totalDamage * 1.5
      ? "healing"
      : "damage";
  const localAmount = profileAmount(local, primaryMetric);
  const benchmarkAmount = profileAmount(benchmark, primaryMetric);
  const localPerSecond = localAmount / Math.max(0.001, local.durationMs / 1000);
  const benchmarkPerSecond =
    benchmarkAmount / Math.max(0.001, benchmark.durationMs / 1000);
  const sameBoss = isSameBoss(local, benchmark);
  const sameClass =
    local.className && benchmark.className
      ? canonicalClass(local.className) === canonicalClass(benchmark.className)
      : null;
  const sameSpecialization =
    local.specialization && benchmark.specialization
      ? canonicalSpecialization(local.specialization) ===
        canonicalSpecialization(benchmark.specialization)
      : null;

  const localAbilities = new Map(local.abilities.map((ability) => [ability.id, ability]));
  const benchmarkAbilities = new Map(
    benchmark.abilities.map((ability) => [ability.id, ability]),
  );
  const abilityIds = new Set([...localAbilities.keys(), ...benchmarkAbilities.keys()]);
  const abilityRows = [...abilityIds]
    .map((id): ComparisonAbilityRow => {
      const localAbility = localAbilities.get(id);
      const benchmarkAbility = benchmarkAbilities.get(id);
      const localValue = localAbility ? abilityAmount(localAbility, primaryMetric) : 0;
      const benchmarkValue = benchmarkAbility
        ? abilityAmount(benchmarkAbility, primaryMetric)
        : 0;
      return {
        id,
        name: localAbility?.name ?? benchmarkAbility?.name ?? `技能 ${id}`,
        localAmount: localValue,
        benchmarkAmount: benchmarkValue,
        delta: benchmarkValue - localValue,
        localCasts: localAbility?.casts ?? 0,
        benchmarkCasts: benchmarkAbility?.casts ?? 0,
        localCritRate: critRate(localAbility),
        benchmarkCritRate: critRate(benchmarkAbility),
        localFirstCastMs: localAbility?.firstCastMs,
        benchmarkFirstCastMs: benchmarkAbility?.firstCastMs,
      };
    })
    .filter((row) => row.localAmount > 0 || row.benchmarkAmount > 0)
    .sort(
      (a, b) =>
        Math.max(b.localAmount, b.benchmarkAmount) -
        Math.max(a.localAmount, a.benchmarkAmount),
    );

  const localActivePercent = activePercent(local);
  const benchmarkActivePercent = activePercent(benchmark);
  const localLongGapMs = longGapMs(local.actionTimestampsMs);
  const benchmarkLongGapMs = longGapMs(benchmark.actionTimestampsMs);
  const insights: ComparisonInsight[] = [];

  if (!sameBoss) {
    insights.push({
      kind: "context",
      priority: 1,
      title: "Boss 不一致，停止直接下结论",
      detail: "不同 Boss 的目标数量、机制停手和战斗长度不可直接比较。请重新选择同一个 Boss。",
      evidence: `${local.bossName} vs ${benchmark.bossName}`,
      confidence: "高",
    });
  }
  if (sameClass === false || sameSpecialization === false) {
    insights.push({
      kind: "context",
      priority: 1,
      title: "职业或专精不一致",
      detail: "技能优先级和职责不同，结果只适合观察战斗环境，不适合作为手法基准。",
      evidence: `${local.className ?? "未知"} ${local.specialization ?? ""} vs ${benchmark.className ?? "未知"} ${benchmark.specialization ?? ""}`,
      confidence: "高",
    });
  }

  const activeGap = benchmarkActivePercent - localActivePercent;
  if (sameBoss && activeGap >= 0.025) {
    insights.push({
      kind: "execution",
      priority: 1,
      title: "先压缩有效操作空窗",
      detail: "优先复盘机制移动前后的断档、目标切换和可移动施法，通常比追求单次伤害更稳定。",
      evidence: `活跃区间 ${percent(localActivePercent)} vs ${percent(benchmarkActivePercent)}`,
      confidence: "中",
    });
  }
  if (sameBoss && localLongGapMs > benchmarkLongGapMs + 2_000) {
    insights.push({
      kind: "execution",
      priority: 1,
      title: "公共 CD 轴存在更多长空窗",
      detail: "在时间轴逐段检查超过 2.25 秒的操作间隔，区分必须停手的机制与可提前规划的空档。",
      evidence: `可疑空窗 ${seconds(localLongGapMs)} vs ${seconds(benchmarkLongGapMs)}`,
      confidence: "中",
    });
  }

  const castOpportunities = abilityRows
    .filter((row) => {
      const benchmarkAbility = benchmarkAbilities.get(row.id);
      if (!benchmarkAbility || PASSIVE_ABILITY_PATTERN.test(row.name)) return false;
      const benchmarkShare = benchmarkAmount
        ? row.benchmarkAmount / benchmarkAmount
        : 0;
      const localRate = row.localCasts / Math.max(1, local.durationMs);
      const benchmarkRate = row.benchmarkCasts / Math.max(1, benchmark.durationMs);
      return (
        row.benchmarkCasts > 0 &&
        benchmarkShare >= 0.02 &&
        benchmarkRate > localRate * 1.12
      );
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  for (const row of castOpportunities) {
    insights.push({
      kind: "execution",
      priority: row.delta > benchmarkAmount * 0.05 ? 1 : 2,
      title: `检查 ${row.name} 的施放机会`,
      detail: "按战斗时长归一后，基准角色的使用频率更高；检查开场顺序、冷却空转和收尾阶段是否少了一次机会。",
      evidence: `施放 ${row.localCasts} vs ${row.benchmarkCasts}，贡献差 ${Math.round(row.delta).toLocaleString("zh-CN")}`,
      confidence: "中",
    });
  }

  const delayedOpeners = abilityRows
    .filter(
      (row) =>
        row.localFirstCastMs !== undefined &&
        row.benchmarkFirstCastMs !== undefined &&
        row.localFirstCastMs > row.benchmarkFirstCastMs + 1_250 &&
        row.benchmarkAmount >= benchmarkAmount * 0.02,
    )
    .sort(
      (a, b) =>
        (b.localFirstCastMs ?? 0) - (b.benchmarkFirstCastMs ?? 0) -
        ((a.localFirstCastMs ?? 0) - (a.benchmarkFirstCastMs ?? 0)),
    )
    .slice(0, 2);
  for (const row of delayedOpeners) {
    insights.push({
      kind: "execution",
      priority: 2,
      title: `${row.name} 首次使用偏晚`,
      detail: "短战斗中首轮延后可能直接少一次冷却；把它放进开场预案，并确认不会挤掉更高优先级技能。",
      evidence: `首次 ${(row.localFirstCastMs! / 1000).toFixed(2)}s vs ${(row.benchmarkFirstCastMs! / 1000).toFixed(2)}s`,
      confidence: "中",
    });
  }

  const localAuras = new Map(local.auras.map((aura) => [aura.id, aura]));
  const auraOpportunities = benchmark.auras
    .map((benchmarkAura) => ({
      local: localAuras.get(benchmarkAura.id),
      benchmark: benchmarkAura,
    }))
    .filter(({ local: localAura, benchmark: benchmarkAura }) => {
      const localCoverage = localAura?.uptimeMs
        ? localAura.uptimeMs / local.durationMs
        : 0;
      const benchmarkCoverage = benchmarkAura.uptimeMs / benchmark.durationMs;
      return benchmarkCoverage >= 0.12 && benchmarkCoverage - localCoverage >= 0.12;
    })
    .sort(
      (a, b) =>
        b.benchmark.uptimeMs / benchmark.durationMs -
        (b.local?.uptimeMs ?? 0) / local.durationMs -
        (a.benchmark.uptimeMs / benchmark.durationMs -
          (a.local?.uptimeMs ?? 0) / local.durationMs),
    )
    .slice(0, 2);
  for (const { local: localAura, benchmark: benchmarkAura } of auraOpportunities) {
    insights.push({
      kind: "context",
      priority: 2,
      title: `核对 ${benchmarkAura.name} 的覆盖与来源`,
      detail: "这可能来自装备、团队外部增益或玩家自己的冷却。先确认来源，再决定是调整爆发对齐还是作为环境差异剔除。",
      evidence: `覆盖 ${percent((localAura?.uptimeMs ?? 0) / local.durationMs)} vs ${percent(benchmarkAura.uptimeMs / benchmark.durationMs)}`,
      confidence: "中",
    });
  }

  const localCrit = totalCritRate(local);
  const benchmarkCrit = totalCritRate(benchmark);
  if (benchmarkCrit - localCrit >= 0.08) {
    insights.push({
      kind: "variance",
      priority: 1,
      title: "基准场次暴击更集中，不能全部算作手法差距",
      detail: "单场短战斗的暴击和触发方差很大。应再比较 5–10 场同 Boss 的中位数，并优先看施法次数与时间轴。",
      evidence: `事件暴击率 ${percent(localCrit)} vs ${percent(benchmarkCrit)}`,
      confidence: "高",
    });
  }

  const durationGap = Math.abs(local.durationMs - benchmark.durationMs);
  if (durationGap >= Math.min(local.durationMs, benchmark.durationMs) * 0.05) {
    insights.push({
      kind: "context",
      priority: 2,
      title: "团队击杀速度会改变技能次数和爆发占比",
      detail: "较短战斗会放大开场爆发，较长战斗可能多出一轮冷却；总伤害和技能次数应同时按每分钟归一。",
      evidence: `战斗 ${seconds(local.durationMs)} vs ${seconds(benchmark.durationMs)}`,
      confidence: "高",
    });
  }

  if (!insights.some((insight) => insight.kind === "execution") && sameBoss) {
    insights.push({
      kind: "execution",
      priority: 3,
      title: "核心施法密度接近，先查技能命中与爆发对齐",
      detail: "当前事件里没有发现明显少按的主技能。继续核对目标选择、Boss 可攻击窗口和关键增益重叠。",
      evidence: `${displayName(local)} ${local.actionTimestampsMs.length} 次操作，${displayName(benchmark)} ${benchmark.actionTimestampsMs.length} 次`,
      confidence: "中",
    });
  }

  return {
    sameBoss,
    sameClass,
    sameSpecialization,
    primaryMetric,
    localPerSecond,
    benchmarkPerSecond,
    perSecondDelta: benchmarkPerSecond - localPerSecond,
    amountDelta: benchmarkAmount - localAmount,
    relativeGap: localPerSecond ? benchmarkPerSecond / localPerSecond - 1 : 0,
    localActivePercent,
    benchmarkActivePercent,
    localLongGapMs,
    benchmarkLongGapMs,
    abilityRows,
    insights: insights.sort((a, b) => a.priority - b.priority),
  };
}

export function localPlayerLabel(player: PlayerMeta): string {
  const identity = [player.specialization, player.className]
    .filter(Boolean)
    .join(" · ");
  return identity ? `${player.name}（${identity}）` : player.name;
}
