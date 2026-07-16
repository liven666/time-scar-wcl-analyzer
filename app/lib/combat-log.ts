export type WowClass =
  | "死亡骑士"
  | "德鲁伊"
  | "猎人"
  | "法师"
  | "圣骑士"
  | "牧师"
  | "潜行者"
  | "萨满祭司"
  | "术士"
  | "战士"
  | "未知";

export type CombatRole = "tank" | "melee" | "ranged" | "unknown";
export type AuraMetric = "armor" | "faerie" | "demonic";

export interface PlayerMeta {
  id: string;
  name: string;
  className: WowClass;
  role: CombatRole;
  damageTaken: number;
  petDamage: number;
  topSpells: Array<{ name: string; damage: number }>;
}

export interface FightResult {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  durationMs: number;
  success: boolean;
  puller: string;
  pullMethod: string;
  actorTargets: Record<string, Record<string, number>>;
  targets: Record<string, number>;
  boostedByActor: Record<string, number>;
  auraMs: Record<AuraMetric, number>;
}

export interface CombatReport {
  version: 1;
  parserVersion: string;
  sourceName: string;
  sourceSize: number;
  generatedAt: string;
  raidName: string;
  timeWindow: string;
  totalLines: number;
  validEvents: number;
  players: PlayerMeta[];
  fights: FightResult[];
  trashActorTargets: Record<string, Record<string, number>>;
  trashTargets: Record<string, number>;
  trashDurationMs: number;
  warnings: string[];
}

export interface ParseOptions {
  startTime?: string;
  endTime?: string;
  mergePets?: boolean;
}

type ProgressCallback = (progress: number, message: string) => void;

interface ActorAccumulator {
  id: string;
  name: string;
  className: WowClass;
  rangedHint: number;
  meleeHint: number;
  tankHint: number;
  damageTaken: number;
  petDamage: number;
  spells: Map<string, number>;
}

interface FightAccumulator {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  success: boolean;
  puller: string;
  pullMethod: string;
  actorTargets: Map<string, Map<string, number>>;
  targets: Map<string, number>;
  boostedByActor: Map<string, number>;
  auraMs: Record<AuraMetric, number>;
}

interface ActiveAura {
  fightId: string;
  metric: AuraMetric;
  startedAt: number;
  count: number;
}

const DAMAGE_EVENTS = new Set([
  "SWING_DAMAGE",
  "RANGE_DAMAGE",
  "SPELL_DAMAGE",
  "SPELL_PERIODIC_DAMAGE",
  "DAMAGE_SHIELD",
  "DAMAGE_SPLIT",
  "ENVIRONMENTAL_DAMAGE",
]);

const AURA_EVENTS = new Set([
  "SPELL_AURA_APPLIED",
  "SPELL_AURA_APPLIED_DOSE",
  "SPELL_AURA_REFRESH",
  "SPELL_AURA_REMOVED",
  "SPELL_AURA_REMOVED_DOSE",
]);

const CLASS_RULES: Array<{
  className: WowClass;
  pattern: RegExp;
  style: CombatRole;
}> = [
  {
    className: "死亡骑士",
    pattern:
      /冰霜打击|湮灭|天灾打击|死亡缠绕|血液沸腾|心脏打击|Death Coil|Frost Strike|Obliterate|Scourge Strike|Heart Strike/i,
    style: "melee",
  },
  {
    className: "德鲁伊",
    pattern:
      /星火术|愤怒|月火术|虫群|撕碎|裂伤|割裂|横扫|Starfire|Wrath|Moonfire|Shred|Mangle|Rip|Swipe/i,
    style: "unknown",
  },
  {
    className: "猎人",
    pattern:
      /稳固射击|瞄准射击|多重射击|奥术射击|爆炸射击|奇美拉射击|Steady Shot|Aimed Shot|Multi-Shot|Arcane Shot|Explosive Shot|Chimera Shot/i,
    style: "ranged",
  },
  {
    className: "法师",
    pattern:
      /寒冰箭|火球术|奥术冲击|炎爆术|冰枪术|暴风雪|Frostbolt|Fireball|Arcane Blast|Pyroblast|Ice Lance|Blizzard/i,
    style: "ranged",
  },
  {
    className: "圣骑士",
    pattern:
      /十字军打击|神圣风暴|复仇者之盾|正义之锤|审判|Crusader Strike|Divine Storm|Avenger's Shield|Hammer of the Righteous|Judgement/i,
    style: "melee",
  },
  {
    className: "牧师",
    pattern:
      /精神鞭笞|暗言术|心灵震爆|噬灵疫病|Mind Flay|Shadow Word|Mind Blast|Devouring Plague/i,
    style: "ranged",
  },
  {
    className: "潜行者",
    pattern:
      /邪恶攻击|毁伤|背刺|刺骨|刀扇|毒伤|Sinister Strike|Mutilate|Backstab|Eviscerate|Fan of Knives|Envenom/i,
    style: "melee",
  },
  {
    className: "萨满祭司",
    pattern:
      /闪电箭|闪电链|熔岩爆裂|风暴打击|火焰震击|Lightning Bolt|Chain Lightning|Lava Burst|Stormstrike|Flame Shock/i,
    style: "ranged",
  },
  {
    className: "术士",
    pattern:
      /暗影箭|腐蚀术|献祭|烧尽|混乱之箭|痛苦无常|Shadow Bolt|Corruption|Immolate|Incinerate|Chaos Bolt|Unstable Affliction/i,
    style: "ranged",
  },
  {
    className: "战士",
    pattern:
      /英勇打击|嗜血|旋风斩|猛击|斩杀|盾牌猛击|复仇|Heroic Strike|Bloodthirst|Whirlwind|Slam|Execute|Shield Slam|Revenge/i,
    style: "melee",
  },
];

const TANK_SPELLS =
  /盾牌猛击|复仇|正义之锤|复仇者之盾|死亡打击|符文打击|熊形态|裂伤.*熊|Shield Slam|Revenge|Hammer of the Righteous|Avenger's Shield|Death Strike|Rune Strike|Bear Form/i;

const RANGED_DRUID_SPELLS =
  /星火术|愤怒|月火术|虫群|Starfire|Wrath|Moonfire|Insect Swarm/i;

const MELEE_DRUID_SPELLS =
  /撕碎|裂伤|割裂|横扫|Shred|Mangle|Rip|Swipe/i;

const BOOST_AURA_PATTERN =
  /光明精华|黑暗精华|邪恶狂热|Light Essence|Dark Essence|Unholy Frenzy/i;

const AURA_PATTERNS: Record<AuraMetric, RegExp> = {
  armor:
    /破甲|破甲攻击|揭底|酸液喷吐|Sunder Armor|Expose Armor|Acid Spit/i,
  faerie: /精灵之火|Faerie Fire/i,
  demonic: /恶魔契约|Demonic Pact/i,
};

function parseCsv(input: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseTimestamp(value: string): number {
  const match = value.match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2}):(\d{2})\.(\d+)$/,
  );
  if (!match) return 0;

  const currentYear = new Date().getFullYear();
  let year = match[3] ? Number(match[3]) : currentYear;
  if (year < 100) year += 2000;
  const milliseconds = Number(match[7].slice(0, 3).padEnd(3, "0"));

  return new Date(
    year,
    Number(match[1]) - 1,
    Number(match[2]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    milliseconds,
  ).getTime();
}

function clockMinutes(timestampLabel: string): number {
  const match = timestampLabel.match(/\s(\d{1,2}):(\d{2}):/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWithinWindow(
  timestampLabel: string,
  startTime?: string,
  endTime?: string,
): boolean {
  if (!startTime && !endTime) return true;
  const current = clockMinutes(timestampLabel);
  const toMinutes = (value?: string) => {
    if (!value) return null;
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  if (start !== null && end !== null && start > end) {
    return current >= start || current <= end;
  }
  if (start !== null && current < start) return false;
  if (end !== null && current > end) return false;
  return true;
}

function isPlayerGuid(guid: string | undefined): boolean {
  return Boolean(guid?.startsWith("Player-"));
}

function isPetGuid(guid: string | undefined): boolean {
  return Boolean(guid?.startsWith("Pet-") || guid?.startsWith("Guardian-"));
}

function isNpcGuid(guid: string | undefined): boolean {
  return Boolean(
    guid?.startsWith("Creature-") ||
      guid?.startsWith("Vehicle-") ||
      guid?.startsWith("GameObject-"),
  );
}

function safeName(value: string | undefined, fallback: string): string {
  if (!value || value === "nil" || value === "Unknown") return fallback;
  return value.replace(/^"|"$/g, "");
}

function numeric(value: string | undefined): number {
  if (!value || value === "nil") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function addToNestedMap(
  map: Map<string, Map<string, number>>,
  actorId: string,
  target: string,
  amount: number,
) {
  const actorTargets = map.get(actorId) ?? new Map<string, number>();
  actorTargets.set(target, (actorTargets.get(target) ?? 0) + amount);
  map.set(actorId, actorTargets);
}

function mapToRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map.entries());
}

function nestedMapToRecord(
  map: Map<string, Map<string, number>>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    [...map.entries()].map(([key, value]) => [key, mapToRecord(value)]),
  );
}

function formatClock(timestampMs: number): string {
  if (!timestampMs) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(timestampMs);
}

class CombatLogParser {
  private readonly options: ParseOptions;
  private readonly sourceName: string;
  private readonly sourceSize: number;
  private readonly actors = new Map<string, ActorAccumulator>();
  private readonly petOwners = new Map<string, string>();
  private readonly fights: FightAccumulator[] = [];
  private readonly trashActorTargets = new Map<string, Map<string, number>>();
  private readonly trashTargets = new Map<string, number>();
  private readonly activeAuras = new Map<string, ActiveAura>();
  private readonly activeBoosts = new Map<string, number>();
  private currentFight: FightAccumulator | null = null;
  private lastTimestamp = 0;
  private firstTimestamp = 0;
  private zoneName = "";
  private unknownPetDamage = 0;
  totalLines = 0;
  validEvents = 0;

  constructor(sourceName: string, sourceSize: number, options: ParseOptions) {
    this.sourceName = sourceName;
    this.sourceSize = sourceSize;
    this.options = options;
  }

  consumeLine(line: string) {
    this.totalLines += 1;
    const match = line.match(
      /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}:\d{2}\.\d+)\s{2,}(.*)$/,
    );
    if (!match || !isWithinWindow(match[1], this.options.startTime, this.options.endTime)) {
      return;
    }

    const timestampMs = parseTimestamp(match[1]);
    if (!timestampMs) return;
    this.firstTimestamp ||= timestampMs;
    this.lastTimestamp = timestampMs;

    const fields = parseCsv(match[2]);
    const event = fields[0];
    if (!event) return;
    this.validEvents += 1;

    if (event === "ZONE_CHANGE") {
      this.zoneName = safeName(fields[2] || fields[1], this.zoneName);
      return;
    }

    if (event === "ENCOUNTER_START") {
      this.startFight(fields, timestampMs, match[1]);
      return;
    }

    if (event === "ENCOUNTER_END") {
      this.endFight(fields, timestampMs);
      return;
    }

    if (event === "SPELL_SUMMON") {
      const ownerGuid = fields[1];
      const petGuid = fields[5];
      if (isPlayerGuid(ownerGuid) && isPetGuid(petGuid)) {
        this.petOwners.set(petGuid, ownerGuid);
        this.ensureActor(ownerGuid, safeName(fields[2], "未知玩家"));
      }
    }

    if (AURA_EVENTS.has(event)) {
      this.consumeAura(fields, event, timestampMs);
    }

    if (DAMAGE_EVENTS.has(event)) {
      this.consumeDamage(fields, event, timestampMs);
    }
  }

  private ensureActor(id: string, name: string): ActorAccumulator {
    const existing = this.actors.get(id);
    if (existing) {
      if (existing.name === "未知玩家" && name !== "未知玩家") existing.name = name;
      return existing;
    }

    const actor: ActorAccumulator = {
      id,
      name,
      className: "未知",
      rangedHint: 0,
      meleeHint: 0,
      tankHint: 0,
      damageTaken: 0,
      petDamage: 0,
      spells: new Map(),
    };
    this.actors.set(id, actor);
    return actor;
  }

  private startFight(fields: string[], timestampMs: number, label: string) {
    if (this.currentFight) this.finishCurrentFight(timestampMs, false);
    const encounterId = safeName(fields[1], String(this.fights.length + 1));
    const name = safeName(fields[2], `Boss战 ${this.fights.length + 1}`);
    const fight: FightAccumulator = {
      id: `${encounterId}-${timestampMs}`,
      name,
      startMs: timestampMs,
      endMs: timestampMs,
      startLabel: label,
      success: false,
      puller: "待识别",
      pullMethod: "等待首个有效伤害事件",
      actorTargets: new Map(),
      targets: new Map(),
      boostedByActor: new Map(),
      auraMs: { armor: 0, faerie: 0, demonic: 0 },
    };
    this.fights.push(fight);
    this.currentFight = fight;
  }

  private endFight(fields: string[], timestampMs: number) {
    if (!this.currentFight) return;
    const success = fields[5] === "1" || fields.at(-1) === "1";
    this.finishCurrentFight(timestampMs, success);
  }

  private finishCurrentFight(timestampMs: number, success: boolean) {
    if (!this.currentFight) return;
    this.currentFight.endMs = Math.max(timestampMs, this.currentFight.startMs + 1);
    this.currentFight.success = success;
    this.closeAurasForFight(this.currentFight, this.currentFight.endMs);
    this.currentFight = null;
  }

  private consumeAura(fields: string[], event: string, timestampMs: number) {
    const destGuid = fields[5];
    const spellName = safeName(fields[10], "");
    if (!destGuid || !spellName) return;

    if (isPlayerGuid(destGuid) && BOOST_AURA_PATTERN.test(spellName)) {
      const current = this.activeBoosts.get(destGuid) ?? 0;
      if (event === "SPELL_AURA_APPLIED" || event === "SPELL_AURA_APPLIED_DOSE") {
        this.activeBoosts.set(destGuid, current + 1);
      } else if (event === "SPELL_AURA_REMOVED") {
        this.activeBoosts.set(destGuid, Math.max(0, current - 1));
      }
    }

    if (!this.currentFight) return;
    const metric = (Object.keys(AURA_PATTERNS) as AuraMetric[]).find((key) =>
      AURA_PATTERNS[key].test(spellName),
    );
    if (!metric) return;
    if (metric !== "demonic" && !isNpcGuid(destGuid)) return;
    if (metric === "demonic" && !isPlayerGuid(destGuid)) return;

    const key = `${this.currentFight.id}:${metric}:${destGuid}`;
    const active = this.activeAuras.get(key);
    if (event === "SPELL_AURA_APPLIED" || event === "SPELL_AURA_APPLIED_DOSE") {
      if (active) {
        active.count += 1;
      } else {
        this.activeAuras.set(key, {
          fightId: this.currentFight.id,
          metric,
          startedAt: timestampMs,
          count: 1,
        });
      }
    } else if (event === "SPELL_AURA_REMOVED") {
      if (!active) return;
      active.count -= 1;
      if (active.count <= 0) {
        this.currentFight.auraMs[metric] += Math.max(0, timestampMs - active.startedAt);
        this.activeAuras.delete(key);
      }
    }
  }

  private closeAurasForFight(fight: FightAccumulator, timestampMs: number) {
    for (const [key, active] of this.activeAuras.entries()) {
      if (active.fightId !== fight.id) continue;
      fight.auraMs[active.metric] += Math.max(0, timestampMs - active.startedAt);
      this.activeAuras.delete(key);
    }
  }

  private consumeDamage(fields: string[], event: string, timestampMs: number) {
    const sourceGuid = fields[1];
    const sourceName = safeName(fields[2], "未知来源");
    const destGuid = fields[5];
    const destName = safeName(fields[6], "未知目标");
    const amountIndex =
      event === "SWING_DAMAGE" ? 9 : event === "ENVIRONMENTAL_DAMAGE" ? 10 : 12;
    const amount = numeric(fields[amountIndex]);
    if (!amount) return;

    if (isNpcGuid(sourceGuid) && isPlayerGuid(destGuid)) {
      const targetActor = this.ensureActor(destGuid, destName);
      targetActor.damageTaken += amount;
      if (this.currentFight?.puller === "待识别") {
        this.currentFight.puller = targetActor.name;
        this.currentFight.pullMethod = `${sourceName} 首次近战/技能命中`;
      }
    }

    if (!isNpcGuid(destGuid)) return;

    let actorGuid = sourceGuid;
    let actorName = sourceName;
    let fromPet = false;
    if (isPetGuid(sourceGuid)) {
      const ownerGuid = this.petOwners.get(sourceGuid);
      if (ownerGuid && this.options.mergePets !== false) {
        actorGuid = ownerGuid;
        actorName = this.actors.get(ownerGuid)?.name ?? "宠物主人";
        fromPet = true;
      } else {
        this.unknownPetDamage += amount;
      }
    }
    if (!actorGuid || (!isPlayerGuid(actorGuid) && !isPetGuid(actorGuid))) return;

    const actor = this.ensureActor(actorGuid, actorName);
    if (fromPet) actor.petDamage += amount;
    const spellName =
      event === "SWING_DAMAGE"
        ? fromPet
          ? "宠物近战"
          : "近战"
        : safeName(fields[10], event);
    actor.spells.set(spellName, (actor.spells.get(spellName) ?? 0) + amount);
    this.inferActor(actor, spellName, event);

    if (this.currentFight) {
      addToNestedMap(this.currentFight.actorTargets, actor.id, destName, amount);
      this.currentFight.targets.set(
        destName,
        (this.currentFight.targets.get(destName) ?? 0) + amount,
      );
      if (this.currentFight.puller === "待识别") {
        this.currentFight.puller = actor.name;
        this.currentFight.pullMethod = `${spellName} 首次造成有效伤害`;
      }
      if ((this.activeBoosts.get(actor.id) ?? 0) > 0) {
        this.currentFight.boostedByActor.set(
          actor.id,
          (this.currentFight.boostedByActor.get(actor.id) ?? 0) + amount,
        );
      }
      this.currentFight.endMs = timestampMs;
    } else {
      addToNestedMap(this.trashActorTargets, actor.id, destName, amount);
      this.trashTargets.set(destName, (this.trashTargets.get(destName) ?? 0) + amount);
    }
  }

  private inferActor(actor: ActorAccumulator, spellName: string, event: string) {
    const rule = CLASS_RULES.find((candidate) => candidate.pattern.test(spellName));
    if (rule) {
      if (actor.className === "未知") actor.className = rule.className;
      if (rule.style === "ranged") actor.rangedHint += 3;
      if (rule.style === "melee") actor.meleeHint += 3;
    }
    if (event === "SWING_DAMAGE") actor.meleeHint += 1;
    if (TANK_SPELLS.test(spellName)) actor.tankHint += 5;
    if (actor.className === "德鲁伊") {
      if (RANGED_DRUID_SPELLS.test(spellName)) actor.rangedHint += 4;
      if (MELEE_DRUID_SPELLS.test(spellName)) actor.meleeHint += 4;
    }
  }

  finish(): CombatReport {
    if (this.currentFight) this.finishCurrentFight(this.lastTimestamp, false);

    const incomingTotal = [...this.actors.values()].reduce(
      (sum, actor) => sum + actor.damageTaken,
      0,
    );
    const incomingLeaders = [...this.actors.values()]
      .sort((a, b) => b.damageTaken - a.damageTaken)
      .slice(0, 2)
      .map((actor) => actor.id);

    const players: PlayerMeta[] = [...this.actors.values()]
      .filter((actor) => actor.spells.size > 0 || actor.damageTaken > 0)
      .map((actor) => {
        const isTank =
          actor.tankHint > 0 ||
          (incomingLeaders.includes(actor.id) &&
            incomingTotal > 0 &&
            actor.damageTaken / incomingTotal >= 0.12);
        let role: CombatRole = "unknown";
        if (isTank) role = "tank";
        else if (actor.rangedHint > actor.meleeHint) role = "ranged";
        else if (actor.meleeHint > 0) role = "melee";
        else if (
          ["猎人", "法师", "牧师", "萨满祭司", "术士"].includes(actor.className)
        ) {
          role = "ranged";
        } else if (
          ["死亡骑士", "圣骑士", "潜行者", "战士"].includes(actor.className)
        ) {
          role = "melee";
        }

        return {
          id: actor.id,
          name: actor.name,
          className: actor.className,
          role,
          damageTaken: actor.damageTaken,
          petDamage: actor.petDamage,
          topSpells: [...actor.spells.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, damage]) => ({ name, damage })),
        };
      });

    const fights = this.fights.map((fight) => {
      const durationMs = Math.max(1, fight.endMs - fight.startMs);
      return {
        id: fight.id,
        name: fight.name,
        startMs: fight.startMs,
        endMs: fight.endMs,
        startLabel: formatClock(fight.startMs),
        durationMs,
        success: fight.success,
        puller: fight.puller,
        pullMethod: fight.pullMethod,
        actorTargets: nestedMapToRecord(fight.actorTargets),
        targets: mapToRecord(fight.targets),
        boostedByActor: mapToRecord(fight.boostedByActor),
        auraMs: {
          armor: Math.min(durationMs, fight.auraMs.armor),
          faerie: Math.min(durationMs, fight.auraMs.faerie),
          demonic: Math.min(durationMs, fight.auraMs.demonic),
        },
      };
    });

    const warnings: string[] = [];
    if (fights.length === 0) {
      warnings.push("未识别到 ENCOUNTER_START，当前日志只能按全局小怪查看。");
    }
    if (this.unknownPetDamage > 0) {
      warnings.push("部分宠物缺少召唤关系，无法自动合并给主人。");
    }
    if (fights.some((fight) => Object.keys(fight.boostedByActor).length > 0)) {
      warnings.push("检测到临时增伤光环，可在规则面板中选择剔除。");
    }

    const windowStart = this.options.startTime || "日志开始";
    const windowEnd = this.options.endTime || "日志结束";
    return {
      version: 1,
      parserVersion: "0.1.0",
      sourceName: this.sourceName,
      sourceSize: this.sourceSize,
      generatedAt: new Date().toISOString(),
      raidName: this.zoneName || (fights[0]?.name ? "时光服团队日志" : "战斗日志"),
      timeWindow: `${windowStart} — ${windowEnd}`,
      totalLines: this.totalLines,
      validEvents: this.validEvents,
      players,
      fights,
      trashActorTargets: nestedMapToRecord(this.trashActorTargets),
      trashTargets: mapToRecord(this.trashTargets),
      trashDurationMs: Math.max(
        1,
        this.lastTimestamp - this.firstTimestamp - fights.reduce((sum, fight) => sum + fight.durationMs, 0),
      ),
      warnings,
    };
  }
}

export async function parseCombatLogFile(
  file: File,
  options: ParseOptions,
  onProgress?: ProgressCallback,
): Promise<CombatReport> {
  const parser = new CombatLogParser(file.name, file.size, options);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let bytesRead = 0;
  let carry = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    const chunk = carry + decoder.decode(value, { stream: true });
    const lines = chunk.split(/\r?\n/);
    carry = lines.pop() ?? "";
    for (const line of lines) parser.consumeLine(line);
    onProgress?.(
      Math.min(96, Math.round((bytesRead / Math.max(file.size, 1)) * 96)),
      `正在本地解析 ${parser.totalLines.toLocaleString("zh-CN")} 行`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  carry += decoder.decode();
  if (carry.trim()) parser.consumeLine(carry);
  onProgress?.(98, "正在生成伤害口径与团队结论");
  const report = parser.finish();
  onProgress?.(100, "解析完成");
  return report;
}

const DEMO_PLAYER_SEEDS: Array<
  PlayerMeta & { boss: number; trash: number; boosted?: number }
> = [
  {
    id: "p-mage",
    name: "冰河旅者",
    className: "法师",
    role: "ranged",
    damageTaken: 104_000,
    petDamage: 0,
    boss: 18_740_000,
    trash: 4_120_000,
    boosted: 410_000,
    topSpells: [
      { name: "寒冰箭", damage: 8_930_000 },
      { name: "冰枪术", damage: 4_240_000 },
      { name: "暴风雪", damage: 3_010_000 },
    ],
  },
  {
    id: "p-warlock",
    name: "暮色契约",
    className: "术士",
    role: "ranged",
    damageTaken: 132_000,
    petDamage: 1_480_000,
    boss: 18_210_000,
    trash: 3_640_000,
    topSpells: [
      { name: "暗影箭", damage: 7_820_000 },
      { name: "腐蚀术", damage: 4_690_000 },
      { name: "恶魔卫士", damage: 1_480_000 },
    ],
  },
  {
    id: "p-rogue",
    name: "静默刀锋",
    className: "潜行者",
    role: "melee",
    damageTaken: 188_000,
    petDamage: 0,
    boss: 17_690_000,
    trash: 3_120_000,
    topSpells: [
      { name: "毁伤", damage: 6_910_000 },
      { name: "毒伤", damage: 5_420_000 },
      { name: "致命毒药", damage: 3_380_000 },
    ],
  },
  {
    id: "p-hunter",
    name: "北境长弓",
    className: "猎人",
    role: "ranged",
    damageTaken: 112_000,
    petDamage: 2_210_000,
    boss: 17_120_000,
    trash: 3_820_000,
    topSpells: [
      { name: "爆炸射击", damage: 6_670_000 },
      { name: "自动射击", damage: 3_980_000 },
      { name: "狼", damage: 2_210_000 },
    ],
  },
  {
    id: "p-dk",
    name: "霜铸誓言",
    className: "死亡骑士",
    role: "melee",
    damageTaken: 246_000,
    petDamage: 0,
    boss: 16_550_000,
    trash: 3_260_000,
    topSpells: [
      { name: "湮灭", damage: 6_220_000 },
      { name: "冰霜打击", damage: 4_810_000 },
      { name: "凛风冲击", damage: 3_160_000 },
    ],
  },
  {
    id: "p-shaman",
    name: "逐风之眼",
    className: "萨满祭司",
    role: "ranged",
    damageTaken: 148_000,
    petDamage: 0,
    boss: 15_920_000,
    trash: 3_330_000,
    topSpells: [
      { name: "闪电箭", damage: 6_180_000 },
      { name: "熔岩爆裂", damage: 4_550_000 },
      { name: "闪电链", damage: 2_990_000 },
    ],
  },
  {
    id: "p-warrior",
    name: "灰烬战歌",
    className: "战士",
    role: "melee",
    damageTaken: 278_000,
    petDamage: 0,
    boss: 15_480_000,
    trash: 2_980_000,
    topSpells: [
      { name: "嗜血", damage: 5_330_000 },
      { name: "英勇打击", damage: 4_620_000 },
      { name: "旋风斩", damage: 3_110_000 },
    ],
  },
  {
    id: "p-druid",
    name: "月下橡树",
    className: "德鲁伊",
    role: "ranged",
    damageTaken: 139_000,
    petDamage: 0,
    boss: 14_860_000,
    trash: 2_740_000,
    topSpells: [
      { name: "星火术", damage: 6_010_000 },
      { name: "愤怒", damage: 4_260_000 },
      { name: "月火术", damage: 2_470_000 },
    ],
  },
  {
    id: "p-paladin",
    name: "晨曦裁决",
    className: "圣骑士",
    role: "melee",
    damageTaken: 302_000,
    petDamage: 0,
    boss: 12_240_000,
    trash: 2_180_000,
    topSpells: [
      { name: "神圣风暴", damage: 4_310_000 },
      { name: "十字军打击", damage: 3_720_000 },
      { name: "审判", damage: 2_460_000 },
    ],
  },
  {
    id: "p-priest",
    name: "无声星尘",
    className: "牧师",
    role: "ranged",
    damageTaken: 166_000,
    petDamage: 0,
    boss: 10_420_000,
    trash: 1_240_000,
    topSpells: [
      { name: "精神鞭笞", damage: 4_180_000 },
      { name: "暗言术：痛", damage: 2_980_000 },
      { name: "噬灵疫病", damage: 2_120_000 },
    ],
  },
  {
    id: "p-tank-warrior",
    name: "铁壁余晖",
    className: "战士",
    role: "tank",
    damageTaken: 7_820_000,
    petDamage: 0,
    boss: 9_820_000,
    trash: 3_080_000,
    topSpells: [
      { name: "盾牌猛击", damage: 3_640_000 },
      { name: "复仇", damage: 2_910_000 },
      { name: "英勇打击", damage: 2_120_000 },
    ],
  },
  {
    id: "p-tank-paladin",
    name: "圣盾刻痕",
    className: "圣骑士",
    role: "tank",
    damageTaken: 6_940_000,
    petDamage: 0,
    boss: 9_260_000,
    trash: 3_360_000,
    topSpells: [
      { name: "正义之锤", damage: 3_220_000 },
      { name: "奉献", damage: 2_880_000 },
      { name: "复仇者之盾", damage: 1_620_000 },
    ],
  },
];

const DEMO_FIGHTS = [
  { name: "阿努布雷坎", duration: 151_000, add: "地穴卫士", armor: 0.99, faerie: 0.97, demonic: 0.94 },
  { name: "黑女巫法琳娜", duration: 183_000, add: "纳克萨玛斯追随者", armor: 0.98, faerie: 0.95, demonic: 0.96 },
  { name: "迈克斯纳", duration: 242_000, add: "迈克斯纳之子", armor: 0.97, faerie: 0.92, demonic: 0.95 },
  { name: "瘟疫使者诺斯", duration: 214_000, add: "瘟疫战士", armor: 0.96, faerie: 0.91, demonic: 0.93 },
  { name: "肮脏的希尔盖", duration: 201_000, add: "眼柄", armor: 0.98, faerie: 0.94, demonic: 0.97 },
  { name: "洛欧塞布", duration: 287_000, add: "孢子", armor: 0.99, faerie: 0.98, demonic: 0.98 },
  { name: "教官拉苏维奥斯", duration: 252_000, add: "死亡骑士学员", armor: 0.95, faerie: 0.89, demonic: 0.92 },
  { name: "四骑士", duration: 318_000, add: "灵魂残片", armor: 0.94, faerie: 0.82, demonic: 0.91 },
];

export function createDemoReport(): CombatReport {
  const start = new Date("2026-07-12T20:08:00+08:00").getTime();
  let cursor = start;
  const weightSum = DEMO_FIGHTS.reduce((sum, _, index) => sum + 1 + index * 0.055, 0);
  const fights: FightResult[] = DEMO_FIGHTS.map((seed, index) => {
    const fightStart = cursor;
    const fightEnd = fightStart + seed.duration;
    cursor = fightEnd + 116_000;
    const actorTargets: Record<string, Record<string, number>> = {};
    const targets: Record<string, number> = { [seed.name]: 0, [seed.add]: 0 };
    const boostedByActor: Record<string, number> = {};
    const weight = (1 + index * 0.055) / weightSum;

    DEMO_PLAYER_SEEDS.forEach((player, playerIndex) => {
      const fightTotal = Math.round(player.boss * weight);
      const addShare = index === 5 ? 0.09 : 0.035 + ((playerIndex + index) % 4) * 0.012;
      const addDamage = Math.round(fightTotal * addShare);
      const bossDamage = fightTotal - addDamage;
      actorTargets[player.id] = {
        [seed.name]: bossDamage,
        [seed.add]: addDamage,
      };
      targets[seed.name] += bossDamage;
      targets[seed.add] += addDamage;
      if (player.boosted && index === 7) boostedByActor[player.id] = player.boosted;
    });

    return {
      id: `demo-${index + 1}`,
      name: seed.name,
      startMs: fightStart,
      endMs: fightEnd,
      startLabel: formatClock(fightStart),
      durationMs: seed.duration,
      success: true,
      puller: ["北境长弓", "铁壁余晖", "静默刀锋", "圣盾刻痕"][index % 4],
      pullMethod: [
        "爆炸射击首次造成伤害",
        "Boss 首次近战命中",
        "毁伤首次造成伤害",
        "复仇者之盾首次造成伤害",
      ][index % 4],
      actorTargets,
      targets,
      boostedByActor,
      auraMs: {
        armor: Math.round(seed.duration * seed.armor),
        faerie: Math.round(seed.duration * seed.faerie),
        demonic: Math.round(seed.duration * seed.demonic),
      },
    };
  });

  const trashActorTargets: Record<string, Record<string, number>> = {};
  const trashTargets: Record<string, number> = {
    "纳克萨玛斯侍僧": 0,
    "恐惧爬行者": 0,
    "缝合巨人": 0,
  };
  DEMO_PLAYER_SEEDS.forEach((player, index) => {
    const first = Math.round(player.trash * (0.34 + (index % 3) * 0.03));
    const second = Math.round(player.trash * (0.38 - (index % 2) * 0.02));
    const third = player.trash - first - second;
    trashActorTargets[player.id] = {
      "纳克萨玛斯侍僧": first,
      "恐惧爬行者": second,
      "缝合巨人": third,
    };
    trashTargets["纳克萨玛斯侍僧"] += first;
    trashTargets["恐惧爬行者"] += second;
    trashTargets["缝合巨人"] += third;
  });

  return {
    version: 1,
    parserVersion: "0.1.0",
    sourceName: "WoWCombatLog_NAXX_demo.txt",
    sourceSize: 247_800_000,
    generatedAt: new Date("2026-07-12T23:18:00+08:00").toISOString(),
    raidName: "纳克萨玛斯 · 时光服 P4.5",
    timeWindow: "20:08 — 23:18",
    totalLines: 832_675,
    validEvents: 211_100,
    players: DEMO_PLAYER_SEEDS.map(({ boss: _boss, trash: _trash, boosted: _boosted, ...player }) => player),
    fights,
    trashActorTargets,
    trashTargets,
    trashDurationMs: 3_240_000,
    warnings: ["四骑士的精灵之火覆盖率低于 90%。", "检测到 1 名玩家处于临时增伤光环。"],
  };
}
