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

export type CombatRole = "tank" | "healer" | "melee" | "ranged" | "unknown";
export type CombatRoleSource = "talent" | "talent+combat" | "combat";
export type AuraMetric = "armor" | "faerie" | "demonic";
export type TimelineEventKind =
  | "damage"
  | "heal"
  | "incoming"
  | "cast"
  | "cast-start"
  | "cast-failed"
  | "miss"
  | "interrupt"
  | "dispel"
  | "death"
  | "resource"
  | "absorb";

export interface CombatTimelineEvent {
  t: number;
  kind: TimelineEventKind;
  sourceActorId?: string;
  sourceUnitId?: string;
  targetId?: string;
  spellId: number;
  extraSpellId?: number;
  amount?: number;
  rawAmount?: number;
  overAmount?: number;
  absorbed?: number;
  blocked?: number;
  resisted?: number;
  critical?: boolean;
  glancing?: boolean;
  crushing?: boolean;
  periodic?: boolean;
  pet?: boolean;
  missType?: string;
  snapshotUnitId?: string;
  hp?: number;
  maxHp?: number;
  resourceType?: number;
  resource?: number;
  resourceMax?: number;
}

export interface CombatAuraWindow {
  sourceActorId?: string;
  sourceUnitId?: string;
  targetId: string;
  spellId: number;
  auraType: "BUFF" | "DEBUFF";
  start: number;
  end: number;
  maxStacks: number;
}

export interface CombatTimelineTarget {
  id: string;
  name: string;
  damage: number;
}

export interface FightTimeline {
  events: CombatTimelineEvent[];
  auras: CombatAuraWindow[];
  targets: CombatTimelineTarget[];
  primaryTargetId?: string;
}

export interface PlayerMeta {
  id: string;
  name: string;
  className: WowClass;
  role: CombatRole;
  specialization?: string;
  talentPoints?: [number, number, number];
  roleSource?: CombatRoleSource;
  damageTaken: number;
  petDamage: number;
  healingDone?: number;
  overhealing?: number;
  absorbDone?: number;
  topSpells: Array<{ spellId?: number; name: string; damage: number }>;
  topHeals?: Array<{ spellId?: number; name: string; healing: number }>;
}

export interface FightTargetExclusion {
  target: string;
  damage: number;
  reason: string;
}

export interface FightAutomaticAdjustment {
  key: string;
  label: string;
  damage: number;
  reason: string;
  actorId?: string;
}

export interface FightResult {
  id: string;
  encounterId?: string;
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
  rawActorTargets?: Record<string, Record<string, number>>;
  rawTargets?: Record<string, number>;
  automaticExclusions?: FightTargetExclusion[];
  automaticAdjustments?: FightAutomaticAdjustment[];
  actorSpellTargets?: Record<
    string,
    Record<string, Record<string, number>>
  >;
  actorHeals?: Record<string, Record<string, number>>;
  boostedByActor: Record<string, number>;
  auraMs: Record<AuraMetric, number>;
  timeline?: FightTimeline;
}

export interface CombatReport {
  version: 1;
  parserVersion: string;
  logVersion?: number;
  advancedLogging?: boolean;
  zones?: string[];
  spellNames?: Record<string, string>;
  unitNames?: Record<string, string>;
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
  classHints: Map<WowClass, number>;
  rangedHint: number;
  meleeHint: number;
  tankHint: number;
  damageTaken: number;
  petDamage: number;
  healingDone: number;
  externalHealingDone: number;
  overhealing: number;
  absorbDone: number;
  spells: Map<number, number>;
  heals: Map<number, number>;
  talentLoadouts: Map<string, number>;
  seenInEncounter: boolean;
  seenCombatantInfo: boolean;
}

interface FightAccumulator {
  id: string;
  encounterId: string;
  name: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  success: boolean;
  puller: string;
  pullMethod: string;
  actorTargets: Map<string, Map<string, number>>;
  targets: Map<string, number>;
  actorSpellTargets: Map<string, Map<number, Map<string, number>>>;
  actorHeals: Map<string, Map<number, number>>;
  targetDamageByGuid: Map<string, number>;
  boostedActorTargets: Map<string, Map<string, number>>;
  normalizationByActor: Map<string, number>;
  twinNormalizationByActor: Map<string, number>;
  auraMs: Record<AuraMetric, number>;
  timelineEvents: CombatTimelineEvent[];
  auraWindows: CombatAuraWindow[];
  activeAuraWindowIndexes: Map<string, number>;
}

interface PendingSwingEvent {
  timestampMs: number;
  event: CombatTimelineEvent;
  actorId?: string;
  actorSpellId?: number;
  targetName?: string;
  targetGuid?: string;
  fromPet?: boolean;
  fight?: FightAccumulator;
  boosted?: boolean;
  twinBoosted?: boolean;
  oldRankingAmount?: number;
  oldNormalizedAmount?: number;
  oldTwinAdjustment?: number;
  oldActorAmount?: number;
  supportActorId?: string;
  supportSpellId?: number;
  oldSupportAmount?: number;
}

interface PendingLandedSwing {
  timestampMs: number;
  payload: DamagePayload;
}

interface ActiveAura {
  fightId: string;
  metric: AuraMetric;
}

interface GlobalAuraState {
  key: string;
  sourceActorId?: string;
  sourceUnitId?: string;
  targetId: string;
  spellId: number;
  auraType: "BUFF" | "DEBUFF";
  stacks: number;
}

interface ActiveSupportAttribution {
  sourceActorId: string;
  spellId: number;
}

type PeriodicSupportSnapshot = ActiveSupportAttribution | null;

const DAMAGE_EVENTS = new Set([
  "SWING_DAMAGE",
  "RANGE_DAMAGE",
  "SPELL_DAMAGE",
  "SPELL_BUILDING_DAMAGE",
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

const CUSTOM_GUARDIAN_DAMAGE_ORIGINS = new Set([1284179, 1284200]);

const CLASS_RULES: Array<{
  className: WowClass;
  pattern: RegExp;
  style: CombatRole;
}> = [
  {
    className: "死亡骑士",
    pattern:
      /冰霜打击|湮灭|天灾打击|血液沸腾|心脏打击|死亡打击|符文打击|凛风冲击|冰冷触摸|暗影打击|枯萎凋零|Frost Strike|Obliterate|Scourge Strike|Heart Strike|Death Strike|Rune Strike|Howling Blast|Icy Touch|Plague Strike/i,
    style: "melee",
  },
  {
    className: "德鲁伊",
    pattern:
      /星火术|愤怒|月火术|虫群|撕碎|裂伤|割裂|横扫|斜掠|野蛮咆哮|回春术|野性成长|生命绽放|愈合|治疗之触|迅捷治愈|宁静|自然之力|Starfire|Wrath|Moonfire|Insect Swarm|Shred|Mangle|Rip|Swipe|Rake|Savage Roar|Rejuvenation|Wild Growth|Lifebloom|Regrowth|Healing Touch|Swiftmend|Tranquility|Force of Nature/i,
    style: "unknown",
  },
  {
    className: "猎人",
    pattern:
      /稳固射击|瞄准射击|多重射击|奥术射击|爆炸射击|奇美拉射击|自动射击|毒蛇钉刺|杀戮命令|黑箭|乱射|杀戮射击|Steady Shot|Aimed Shot|Multi-Shot|Arcane Shot|Explosive Shot|Chimera Shot|Auto Shot|Serpent Sting|Kill Command|Black Arrow|Volley|Kill Shot/i,
    style: "ranged",
  },
  {
    className: "法师",
    pattern:
      /寒冰箭|火球术|奥术冲击|奥术飞弹|炎爆术|冰枪术|暴风雪|活体炸弹|灼烧|火焰冲击|霜火之箭|召唤水元素|Frostbolt|Fireball|Arcane Blast|Arcane Missiles|Pyroblast|Ice Lance|Blizzard|Living Bomb|Scorch|Fire Blast|Frostfire Bolt|Summon Water Elemental/i,
    style: "ranged",
  },
  {
    className: "圣骑士",
    pattern:
      /十字军打击|神圣风暴|复仇者之盾|正义之锤|正义盾击|审判|奉献|驱邪术|愤怒之锤|神圣愤怒|圣光术|圣光闪现|圣光道标|神圣震击|Crusader Strike|Divine Storm|Avenger's Shield|Hammer of the Righteous|Shield of Righteousness|Judgement|Consecration|Exorcism|Hammer of Wrath|Holy Wrath|Holy Light|Flash of Light|Beacon of Light|Holy Shock/i,
    style: "melee",
  },
  {
    className: "牧师",
    pattern:
      /精神鞭笞|暗言术|心灵震爆|噬灵疫病|吸血鬼之触|苦修|真言术|恢复|治疗祷言|快速治疗|强效治疗术|神圣新星|神圣之火|Mind Flay|Shadow Word|Mind Blast|Devouring Plague|Vampiric Touch|Penance|Power Word|Renew|Prayer of Healing|Flash Heal|Greater Heal|Holy Nova|Holy Fire/i,
    style: "ranged",
  },
  {
    className: "潜行者",
    pattern:
      /邪恶攻击|影袭|毁伤|背刺|刺骨|刀扇|毒伤|锁喉|切割|割裂|致命毒药|速效毒药|Sinister Strike|Mutilate|Backstab|Eviscerate|Fan of Knives|Envenom|Garrote|Slice and Dice|Rupture|Deadly Poison|Instant Poison/i,
    style: "melee",
  },
  {
    className: "萨满祭司",
    pattern:
      /闪电箭|闪电链|熔岩爆裂|风暴打击|火焰震击|熔岩猛击|治疗链|次级治疗波|治疗波|激流|大地之盾|闪电之盾|Lightning Bolt|Chain Lightning|Lava Burst|Stormstrike|Flame Shock|Lava Lash|Chain Heal|Lesser Healing Wave|Healing Wave|Riptide|Earth Shield|Lightning Shield/i,
    style: "ranged",
  },
  {
    className: "术士",
    pattern:
      /暗影箭|腐蚀术|献祭|烧尽|混乱之箭|痛苦无常|鬼影缠身|痛苦诅咒|厄运诅咒|腐蚀之种|暗影灼烧|灵魂之火|生命虹吸|火焰箭|Shadow Bolt|Corruption|Immolate|Incinerate|Chaos Bolt|Unstable Affliction|Haunt|Curse of Agony|Curse of Doom|Seed of Corruption|Shadowburn|Soul Fire|Siphon Life|Firebolt/i,
    style: "ranged",
  },
  {
    className: "战士",
    pattern:
      /英勇打击|嗜血|旋风斩|猛击|斩杀|盾牌猛击|复仇|毁灭打击|雷霆一击|震荡猛击|致死打击|压制|顺劈斩|Heroic Strike|Bloodthirst|Whirlwind|Slam|Execute|Shield Slam|Revenge|Devastate|Thunder Clap|Concussion Blow|Mortal Strike|Overpower|Cleave/i,
    style: "melee",
  },
];

const TANK_SPELLS =
  /盾牌猛击|复仇|正义之锤|复仇者之盾|死亡打击|符文打击|熊形态|裂伤.*熊|Shield Slam|Revenge|Hammer of the Righteous|Avenger's Shield|Death Strike|Rune Strike|Bear Form/i;

const RANGED_DRUID_SPELLS =
  /星火术|愤怒|月火术|虫群|Starfire|Wrath|Moonfire|Insect Swarm/i;

const MELEE_DRUID_SPELLS =
  /撕碎|裂伤|割裂|横扫|Shred|Mangle|Rip|Swipe/i;

const SPECIALIZATION_TREES: Partial<Record<WowClass, readonly [string, string, string]>> = {
  死亡骑士: ["鲜血", "冰霜", "邪恶"],
  德鲁伊: ["平衡", "野性战斗", "恢复"],
  猎人: ["野兽控制", "射击", "生存"],
  法师: ["奥术", "火焰", "冰霜"],
  圣骑士: ["神圣", "防护", "惩戒"],
  牧师: ["戒律", "神圣", "暗影"],
  潜行者: ["刺杀", "战斗", "敏锐"],
  萨满祭司: ["元素", "增强", "恢复"],
  术士: ["痛苦", "恶魔学识", "毁灭"],
  战士: ["武器", "狂怒", "防护"],
};

const WCL_TARGET_EXCLUSIONS: Record<
  string,
  Record<string, string>
> = {
  // WCL 的默认 Damage Done 会保留战斗事件与时间轴，但从该 Boss
  // 的排名伤害中移除这些机制目标。
  "791": {
    祖利安徘徊者: "WCL 娅尔罗口径：潜行者阶段小怪不计排名伤害",
  },
  "792": {
    祭品巨魔: "WCL 金度口径：祭品机制目标不计排名伤害",
    老鼠: "环境生物不计 Boss 排名伤害",
  },
  "790": {
    钩齿狂鱼: "WCL 加兹兰卡口径：召来的鱼群不计排名伤害",
  },
  "786": {
    蜘蛛: "环境生物不计 Boss 排名伤害",
  },
};

function dominantTalentTree(
  points: [number, number, number],
): 0 | 1 | 2 {
  let index: 0 | 1 | 2 = 0;
  if (points[1] > points[index]) index = 1;
  if (points[2] > points[index]) index = 2;
  return index;
}

function parseCombatantTalents(
  fields: string[],
): [number, number, number] | undefined {
  // Advanced log v9 writes (tree1,tree2,tree3). The regular CSV tokenizer
  // intentionally keeps compatibility with combat events, so this tuple is
  // split across three fields and reconstructed here.
  for (let index = 20; index < Math.min(fields.length - 2, 36); index += 1) {
    const tuple = `${fields[index]},${fields[index + 1]},${fields[index + 2]}`;
    const match = tuple.match(/^\((\d+),(\d+),(\d+)\)$/);
    if (!match) continue;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  return undefined;
}

function selectedTalentPoints(
  actor: ActorAccumulator,
): [number, number, number] | undefined {
  const loadout = [...actor.talentLoadouts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  if (!loadout) return undefined;
  const values = loadout.split("/").map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return [values[0], values[1], values[2]];
}

function talentIdentity(
  className: WowClass,
  points: [number, number, number] | undefined,
  combatTank: boolean,
): {
  specialization?: string;
  role?: CombatRole;
  roleSource?: CombatRoleSource;
} {
  if (!points) return {};
  const trees = SPECIALIZATION_TREES[className];
  if (!trees) return {};
  const tree = dominantTalentTree(points);
  const specialization = trees[tree];

  if (className === "圣骑士") {
    return {
      specialization,
      role: tree === 0 ? "healer" : tree === 1 ? "tank" : "melee",
      roleSource: "talent",
    };
  }
  if (className === "牧师") {
    return {
      specialization,
      role: tree === 2 ? "ranged" : "healer",
      roleSource: "talent",
    };
  }
  if (className === "萨满祭司") {
    return {
      specialization,
      role: tree === 0 ? "ranged" : tree === 1 ? "melee" : "healer",
      roleSource: "talent",
    };
  }
  if (className === "战士") {
    return {
      specialization,
      role: tree === 2 ? "tank" : "melee",
      roleSource: "talent",
    };
  }
  if (className === "德鲁伊") {
    return {
      specialization,
      role:
        tree === 0 ? "ranged" : tree === 2 ? "healer" : combatTank ? "tank" : "melee",
      roleSource: tree === 1 ? "talent+combat" : "talent",
    };
  }
  if (className === "死亡骑士") {
    return {
      specialization,
      role: tree === 0 && combatTank ? "tank" : "melee",
      roleSource: tree === 0 ? "talent+combat" : "talent",
    };
  }
  if (className === "猎人" || className === "法师" || className === "术士") {
    return { specialization, role: "ranged", roleSource: "talent" };
  }
  if (className === "潜行者") {
    return { specialization, role: "melee", roleSource: "talent" };
  }
  return { specialization };
}

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

function isPlayerGuid(guid: string | undefined): guid is string {
  return Boolean(guid?.startsWith("Player-"));
}

function isPetGuid(guid: string | undefined): guid is string {
  return Boolean(guid?.startsWith("Pet-") || guid?.startsWith("Guardian-"));
}

function isNpcGuid(guid: string | undefined): guid is string {
  return Boolean(
    guid?.startsWith("Creature-") ||
      guid?.startsWith("Vehicle-") ||
      guid?.startsWith("GameObject-"),
  );
}

function isOwnableUnitGuid(guid: string | undefined): guid is string {
  return Boolean(
    guid?.startsWith("Pet-") ||
      guid?.startsWith("Guardian-") ||
      guid?.startsWith("Creature-") ||
      guid?.startsWith("Vehicle-"),
  );
}

function isGuidToken(value: string | undefined): boolean {
  return Boolean(
    value === "0000000000000000" ||
      value === "nil" ||
      isPlayerGuid(value) ||
      isPetGuid(value) ||
      isNpcGuid(value),
  );
}

function objectFlags(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFriendlyUnit(flags: string | undefined): boolean {
  const parsed = objectFlags(flags);
  return parsed !== null && (parsed & 0x10) !== 0;
}

function isHostileOrNeutralUnit(flags: string | undefined): boolean {
  const parsed = objectFlags(flags);
  return parsed !== null && (parsed & 0x60) !== 0;
}

function isDamageTarget(guid: string | undefined, flags: string | undefined): boolean {
  if (!guid || isPlayerGuid(guid) || guid === "0000000000000000") return false;
  if (isHostileOrNeutralUnit(flags)) return true;
  if (isFriendlyUnit(flags)) return false;
  return isNpcGuid(guid);
}

function safeName(value: string | undefined, fallback: string): string {
  if (!value || value === "nil" || value === "Unknown") return fallback;
  return value.replace(/^"|"$/g, "");
}

function playerName(value: string | undefined, fallback = "未知玩家"): string {
  return safeName(value, fallback).replace(/-[^-]+-CN$/, "");
}

function isPlaceholderName(value: string): boolean {
  return value === "未知玩家" || value === "宠物主人";
}

function numeric(value: string | undefined): number {
  if (!value || value === "nil") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function signedNumeric(value: string | undefined): number {
  if (!value || value === "nil") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function spellId(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface UnitSnapshot {
  unitId: string;
  ownerId?: string;
  hp: number;
  maxHp: number;
  resourceType: number;
  resource: number;
  resourceMax: number;
}

function parseAdvancedSnapshot(
  fields: string[],
  start: number,
): UnitSnapshot | undefined {
  if (!isGuidToken(fields[start]) || !isGuidToken(fields[start + 1])) {
    return undefined;
  }
  const unitId = fields[start];
  if (!unitId || unitId === "nil" || unitId === "0000000000000000") {
    return undefined;
  }
  const ownerId = isPlayerGuid(fields[start + 1]) ? fields[start + 1] : undefined;
  return {
    unitId,
    ownerId,
    hp: numeric(fields[start + 2]),
    maxHp: numeric(fields[start + 3]),
    resourceType: signedNumeric(fields[start + 9]),
    resource: numeric(fields[start + 10]),
    resourceMax: numeric(fields[start + 11]),
  };
}

interface DamagePayload {
  amount: number;
  landedAmount: number;
  rawAmount: number;
  overkill: number;
  resisted: number;
  blocked: number;
  absorbed: number;
  critical: boolean;
  glancing: boolean;
  crushing: boolean;
  advanced: boolean;
  snapshot?: UnitSnapshot;
}

function parseDamagePayload(fields: string[], event: string): DamagePayload {
  const legacyAmountIndex =
    event === "SWING_DAMAGE" ? 9 : event === "ENVIRONMENTAL_DAMAGE" ? 10 : 12;
  const snapshotStart =
    event === "SWING_DAMAGE" || event === "ENVIRONMENTAL_DAMAGE" ? 9 : 12;
  const advancedAmountIndex =
    snapshotStart + (event === "ENVIRONMENTAL_DAMAGE" ? 19 : 18);
  const advancedOverkillIndex = advancedAmountIndex + 2;
  const advanced =
    fields.length > advancedOverkillIndex &&
    isGuidToken(fields[snapshotStart]) &&
    isGuidToken(fields[snapshotStart + 1]);
  const amountIndex = advanced ? advancedAmountIndex : legacyAmountIndex;
  const advancedShift = advanced ? 1 : 0;
  const overkillIndex = amountIndex + 1 + advancedShift;
  const landedAmount = numeric(fields[amountIndex]);
  const rawAmount = advanced
    ? numeric(fields[amountIndex + 1])
    : landedAmount;
  const overkill = numeric(fields[overkillIndex]);
  return {
    amount: Math.max(0, landedAmount - overkill),
    landedAmount,
    rawAmount: rawAmount || landedAmount,
    overkill,
    resisted: numeric(fields[amountIndex + 3 + advancedShift]),
    blocked: numeric(fields[amountIndex + 4 + advancedShift]),
    absorbed: numeric(fields[amountIndex + 5 + advancedShift]),
    critical: fields[amountIndex + 6 + advancedShift] === "1",
    glancing: fields[amountIndex + 7 + advancedShift] === "1",
    crushing: fields[amountIndex + 8 + advancedShift] === "1",
    advanced,
    snapshot: advanced
      ? parseAdvancedSnapshot(fields, snapshotStart)
      : undefined,
  };
}

function supportDamageContribution(
  payload: DamagePayload,
  rankingCap: number,
): number {
  return Math.min(
    rankingCap,
    Math.floor((payload.amount + payload.absorbed) / 6),
  );
}

interface HealPayload {
  amount: number;
  rawAmount: number;
  overheal: number;
  absorbed: number;
  critical: boolean;
  advanced: boolean;
  snapshot?: UnitSnapshot;
}

function parseHealPayload(fields: string[]): HealPayload {
  const snapshotStart = 12;
  const advanced =
    fields.length > 34 &&
    isGuidToken(fields[snapshotStart]) &&
    isGuidToken(fields[snapshotStart + 1]);
  const amountIndex = advanced ? snapshotStart + 18 : 12;
  const advancedShift = advanced ? 1 : 0;
  const landedAmount = numeric(fields[amountIndex]);
  const rawAmount = advanced
    ? numeric(fields[amountIndex + 1])
    : landedAmount;
  const overheal = numeric(fields[amountIndex + 1 + advancedShift]);
  return {
    amount: Math.max(0, landedAmount - overheal),
    rawAmount: rawAmount || landedAmount,
    overheal,
    absorbed: numeric(fields[amountIndex + 2 + advancedShift]),
    critical: fields[amountIndex + 3 + advancedShift] === "1",
    advanced,
    snapshot: advanced
      ? parseAdvancedSnapshot(fields, snapshotStart)
      : undefined,
  };
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

function addToActorSpellTargets(
  map: Map<string, Map<number, Map<string, number>>>,
  actorId: string,
  spell: number,
  target: string,
  amount: number,
) {
  const actorSpells = map.get(actorId) ?? new Map<number, Map<string, number>>();
  const targets = actorSpells.get(spell) ?? new Map<string, number>();
  targets.set(target, (targets.get(target) ?? 0) + amount);
  actorSpells.set(spell, targets);
  map.set(actorId, actorSpells);
}

function addToActorSpellAmounts(
  map: Map<string, Map<number, number>>,
  actorId: string,
  spell: number,
  amount: number,
) {
  const spells = map.get(actorId) ?? new Map<number, number>();
  spells.set(spell, (spells.get(spell) ?? 0) + amount);
  map.set(actorId, spells);
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

function actorSpellTargetsToRecord(
  map: Map<string, Map<number, Map<string, number>>>,
  excludedTargets: ReadonlySet<string> = new Set(),
): Record<string, Record<string, Record<string, number>>> {
  return Object.fromEntries(
    [...map.entries()].map(([actorId, spells]) => [
      actorId,
      Object.fromEntries(
        [...spells.entries()].map(([abilityId, targets]) => [
          String(abilityId),
          Object.fromEntries(
            [...targets.entries()].filter(
              ([target]) => !excludedTargets.has(target),
            ),
          ),
        ]),
      ),
    ]),
  );
}

function actorSpellAmountsToRecord(
  map: Map<string, Map<number, number>>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    [...map.entries()].map(([actorId, spells]) => [
      actorId,
      Object.fromEntries(
        [...spells.entries()].map(([abilityId, amount]) => [
          String(abilityId),
          amount,
        ]),
      ),
    ]),
  );
}

function filterNestedTargets(
  map: Map<string, Map<string, number>>,
  excludedTargets: ReadonlySet<string>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    [...map.entries()].map(([actorId, targets]) => [
      actorId,
      Object.fromEntries(
        [...targets.entries()].filter(
          ([target]) => !excludedTargets.has(target),
        ),
      ),
    ]),
  );
}

function filterTargets(
  map: Map<string, number>,
  excludedTargets: ReadonlySet<string>,
): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].filter(([target]) => !excludedTargets.has(target)),
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
  private sourceSize: number;
  private readonly actors = new Map<string, ActorAccumulator>();
  private readonly petOwners = new Map<string, string>();
  private readonly guardianOriginSpells = new Map<string, number>();
  private readonly ownedUnitNameOwners = new Map<string, Set<string>>();
  private readonly spellNames = new Map<number, string>([
    [0, "近战"],
    [-1, "宠物近战"],
    [-2, "环境伤害"],
  ]);
  private readonly unitNames = new Map<string, string>();
  private readonly fights: FightAccumulator[] = [];
  private readonly trashActorTargets = new Map<string, Map<string, number>>();
  private readonly trashTargets = new Map<string, number>();
  private readonly activeAuras = new Map<string, ActiveAura>();
  private readonly activeAuraCounts = new Map<string, number>();
  private readonly activeAuraStarts = new Map<string, number>();
  private readonly activeBoostAuras = new Set<string>();
  private readonly activeBoostCounts = new Map<string, number>();
  private readonly activeSupportAttribution = new Map<
    string,
    ActiveSupportAttribution
  >();
  private readonly periodicSupportSnapshots = new Map<
    string,
    PeriodicSupportSnapshot
  >();
  private readonly activeVoidPowerStacks = new Map<string, number>();
  private readonly activeTwinEmpowerment = new Map<
    string,
    "light" | "dark"
  >();
  private readonly globalAuras = new Map<string, GlobalAuraState>();
  private readonly pendingSwingEvents = new Map<string, PendingSwingEvent[]>();
  private readonly pendingLandedSwings = new Map<
    string,
    PendingLandedSwing[]
  >();
  private readonly lastIncomingByTarget = new Map<
    string,
    CombatTimelineEvent
  >();
  private currentFight: FightAccumulator | null = null;
  private logVersion = 0;
  private advancedLogging = false;
  private firstTimestamp = 0;
  private lastTimestamp = 0;
  private currentZone = "";
  private readonly encounterZones: string[] = [];
  private unknownPetDamage = 0;
  private readonly unknownPetSources = new Map<
    string,
    { name: string; damage: number }
  >();
  private trashDurationMs = 0;
  private trashWindowStart = 0;
  private trashLastDamageAt = 0;
  totalLines = 0;
  validEvents = 0;

  constructor(sourceName: string, sourceSize: number, options: ParseOptions) {
    this.sourceName = sourceName;
    this.sourceSize = sourceSize;
    this.options = options;
  }

  consumeLine(line: string) {
    this.totalLines += 1;
    const normalizedLine = line.replace(/^\uFEFF/, "");
    const match = normalizedLine.match(
      /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2}:\d{2}\.\d+)\s+(.*)$/,
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

    if (event === "COMBAT_LOG_VERSION") {
      this.logVersion = Number(fields[1]) || this.logVersion;
      if (fields[2] === "ADVANCED_LOG_ENABLED") {
        this.advancedLogging = fields[3] === "1";
      }
      return;
    }

    if (event === "ZONE_CHANGE") {
      this.currentZone = safeName(fields[2] || fields[1], this.currentZone);
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

    if (event === "COMBATANT_INFO") {
      const playerGuid = fields[1];
      if (isPlayerGuid(playerGuid)) {
        const actor = this.ensureActor(playerGuid, "未知玩家");
        actor.seenCombatantInfo = true;
        actor.seenInEncounter ||= Boolean(this.currentFight);
        const talents = parseCombatantTalents(fields);
        if (talents) {
          const key = talents.join("/");
          actor.talentLoadouts.set(
            key,
            (actor.talentLoadouts.get(key) ?? 0) + 1,
          );
        }
      }
      return;
    }

    this.capturePlayerIdentity(fields[1], fields[2]);
    this.capturePlayerIdentity(fields[5], fields[6]);
    this.captureUnitIdentity(fields[1], fields[2]);
    this.captureUnitIdentity(fields[5], fields[6]);
    this.captureOwnershipHints(fields);

    if (event === "SPELL_SUMMON") {
      const ownerGuid = this.resolveOwnerGuid(fields[1]);
      const summonedGuid = fields[5];
      if (ownerGuid && isOwnableUnitGuid(summonedGuid)) {
        this.linkOwner(summonedGuid, ownerGuid);
        this.rememberOwnedUnitName(fields[6], ownerGuid);
        const originSpellId = this.registerSpell(fields[9], fields[10]);
        if (CUSTOM_GUARDIAN_DAMAGE_ORIGINS.has(originSpellId)) {
          this.guardianOriginSpells.set(summonedGuid, originSpellId);
          this.spellNames.set(
            -originSpellId,
            safeName(fields[10], `技能 ${originSpellId}`),
          );
        }
      }
    }

    this.observeSpell(fields, event);

    if (AURA_EVENTS.has(event)) {
      this.consumeAura(fields, event, timestampMs);
    }

    if (event === "SWING_DAMAGE_LANDED") {
      this.enrichSwingDamage(fields, timestampMs);
      return;
    }

    if (DAMAGE_EVENTS.has(event)) {
      this.consumeDamage(fields, event, timestampMs);
      return;
    }

    if (event === "SPELL_HEAL" || event === "SPELL_PERIODIC_HEAL") {
      this.consumeHeal(fields, event, timestampMs);
      return;
    }

    if (event === "SPELL_ABSORBED") {
      this.consumeAbsorb(fields, timestampMs);
      return;
    }

    if (event === "SPELL_HEAL_ABSORBED") {
      this.consumeHealAbsorbed(fields, timestampMs);
      return;
    }

    if (event === "SPELL_CAST_START" || event === "SPELL_CAST_SUCCESS") {
      this.consumeCast(fields, event, timestampMs);
      return;
    }

    if (event === "SPELL_CAST_FAILED") {
      this.consumeCastFailed(fields, timestampMs);
      return;
    }

    if (
      event === "SPELL_MISSED" ||
      event === "SPELL_PERIODIC_MISSED" ||
      event === "RANGE_MISSED" ||
      event === "SWING_MISSED" ||
      event === "DAMAGE_SHIELD_MISSED"
    ) {
      this.consumeMiss(fields, event, timestampMs);
      return;
    }

    if (event === "SPELL_INTERRUPT") {
      this.consumeInterrupt(fields, timestampMs);
      return;
    }

    if (event === "SPELL_DISPEL" || event === "SPELL_STOLEN") {
      this.consumeDispel(fields, timestampMs);
      return;
    }

    if (
      event === "SPELL_ENERGIZE" ||
      event === "SPELL_PERIODIC_ENERGIZE" ||
      event === "SPELL_DRAIN" ||
      event === "SPELL_PERIODIC_DRAIN" ||
      event === "SPELL_LEECH"
    ) {
      this.consumeResource(fields, event, timestampMs);
      return;
    }

    if (
      event === "UNIT_DIED" ||
      event === "UNIT_DESTROYED" ||
      event === "SPELL_INSTAKILL"
    ) {
      this.consumeDeath(fields, event, timestampMs);
    }
  }

  private ensureActor(id: string, name: string): ActorAccumulator {
    const existing = this.actors.get(id);
    if (existing) {
      if (isPlaceholderName(existing.name) && !isPlaceholderName(name)) {
        existing.name = name;
      }
      return existing;
    }

    const actor: ActorAccumulator = {
      id,
      name,
      className: "未知",
      classHints: new Map(),
      rangedHint: 0,
      meleeHint: 0,
      tankHint: 0,
      damageTaken: 0,
      petDamage: 0,
      healingDone: 0,
      externalHealingDone: 0,
      overhealing: 0,
      absorbDone: 0,
      spells: new Map(),
      heals: new Map(),
      talentLoadouts: new Map(),
      seenInEncounter: false,
      seenCombatantInfo: false,
    };
    this.actors.set(id, actor);
    return actor;
  }

  private capturePlayerIdentity(guid: string | undefined, rawName: string | undefined) {
    if (!isPlayerGuid(guid)) return;
    const actor = this.ensureActor(guid, playerName(rawName));
    actor.seenInEncounter ||= Boolean(this.currentFight);
  }

  private captureUnitIdentity(guid: string | undefined, rawName: string | undefined) {
    if (!guid || guid === "0000000000000000" || guid === "nil") return;
    const name = isPlayerGuid(guid)
      ? playerName(rawName)
      : safeName(rawName, "未知目标");
    const current = this.unitNames.get(guid);
    if (!current || current === "未知目标" || current === "未知玩家") {
      this.unitNames.set(guid, name);
    }
  }

  private registerSpell(rawId: string | undefined, rawName: string | undefined): number {
    const id = spellId(rawId);
    const name = safeName(rawName, id ? `技能 ${id}` : "近战");
    if (!this.spellNames.has(id) || this.spellNames.get(id)?.startsWith("技能 ")) {
      this.spellNames.set(id, name);
    }
    return id;
  }

  private timelineOffset(timestampMs: number): number {
    if (!this.currentFight) return 0;
    return Math.max(0, timestampMs - this.currentFight.startMs);
  }

  private addTimelineEvent(event: CombatTimelineEvent): CombatTimelineEvent | undefined {
    if (!this.currentFight) return undefined;
    this.currentFight.timelineEvents.push(event);
    return event;
  }

  private captureOwnershipHints(fields: string[]) {
    const lastIndex = Math.min(fields.length - 1, 32);
    for (let index = 9; index < lastIndex; index += 1) {
      const unitGuid = fields[index];
      const ownerGuid = fields[index + 1];
      if (isOwnableUnitGuid(unitGuid) && isPlayerGuid(ownerGuid)) {
        this.linkOwner(unitGuid, ownerGuid);
        if (unitGuid === fields[1]) {
          this.rememberOwnedUnitName(fields[2], ownerGuid);
        } else if (unitGuid === fields[5]) {
          this.rememberOwnedUnitName(fields[6], ownerGuid);
        }
      }
    }
  }

  private linkOwner(unitGuid: string | undefined, ownerGuid: string | undefined) {
    if (!unitGuid || !ownerGuid || !isPlayerGuid(ownerGuid)) return;
    this.petOwners.set(unitGuid, ownerGuid);
    const owner = this.ensureActor(ownerGuid, "未知玩家");
    owner.seenInEncounter ||= Boolean(this.currentFight);
  }

  private rememberOwnedUnitName(
    rawName: string | undefined,
    ownerGuid: string | undefined,
  ) {
    if (!ownerGuid) return;
    const name = safeName(rawName, "");
    if (!name || name === "未知目标") return;
    const owners = this.ownedUnitNameOwners.get(name) ?? new Set<string>();
    owners.add(ownerGuid);
    this.ownedUnitNameOwners.set(name, owners);
  }

  private resolveOwnerByName(name: string): string | undefined {
    const owners = this.ownedUnitNameOwners.get(name);
    if (!owners || owners.size !== 1) return undefined;
    return owners.values().next().value;
  }

  private resolveOwnerGuid(guid: string | undefined): string | undefined {
    if (!guid) return undefined;
    if (isPlayerGuid(guid)) return guid;
    let current = guid;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const owner = this.petOwners.get(current);
      if (!owner) return undefined;
      if (isPlayerGuid(owner)) return owner;
      current = owner;
    }
    return undefined;
  }

  private observeSpell(fields: string[], event: string) {
    const isClassAbilityEvent =
      event === "SPELL_CAST_START" ||
      event === "SPELL_CAST_SUCCESS" ||
      event === "SPELL_CAST_FAILED" ||
      event === "SPELL_DAMAGE" ||
      event === "SPELL_PERIODIC_DAMAGE" ||
      event === "SPELL_HEAL" ||
      event === "SPELL_PERIODIC_HEAL" ||
      event === "SPELL_SUMMON" ||
      event === "RANGE_DAMAGE" ||
      event === "DAMAGE_SHIELD" ||
      event === "DAMAGE_SPLIT";
    if (!isClassAbilityEvent) return;

    const spellName = safeName(fields[10], "");
    const ownerGuid = this.resolveOwnerGuid(fields[1]);
    if (!spellName || !ownerGuid) return;
    const sourceName = isPlayerGuid(fields[1])
      ? playerName(fields[2])
      : this.actors.get(ownerGuid)?.name ?? "宠物主人";
    const actor = this.ensureActor(ownerGuid, sourceName);
    actor.seenInEncounter ||= Boolean(this.currentFight);
    this.inferActor(actor, spellName, event);
  }

  private startFight(fields: string[], timestampMs: number, label: string) {
    if (this.currentFight) this.finishCurrentFight(timestampMs, false);
    this.activeVoidPowerStacks.clear();
    this.activeTwinEmpowerment.clear();
    const encounterId = safeName(fields[1], String(this.fights.length + 1));
    const name = safeName(fields[2], `Boss战 ${this.fights.length + 1}`);
    const fight: FightAccumulator = {
      id: `${encounterId}-${timestampMs}`,
      encounterId,
      name,
      startMs: timestampMs,
      endMs: timestampMs,
      startLabel: label,
      success: false,
      puller: "待识别",
      pullMethod: "等待首个有效伤害事件",
      actorTargets: new Map(),
      targets: new Map(),
      actorSpellTargets: new Map(),
      actorHeals: new Map(),
      targetDamageByGuid: new Map(),
      boostedActorTargets: new Map(),
      normalizationByActor: new Map(),
      twinNormalizationByActor: new Map(),
      auraMs: { armor: 0, faerie: 0, demonic: 0 },
      timelineEvents: [],
      auraWindows: [],
      activeAuraWindowIndexes: new Map(),
    };
    this.fights.push(fight);
    this.currentFight = fight;
    this.seedTimelineAuras(fight);
    if (this.currentZone && !this.encounterZones.includes(this.currentZone)) {
      this.encounterZones.push(this.currentZone);
    }
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
    this.discardUnconfirmedSwingEvents();
    this.closeAurasForFight(this.currentFight, this.currentFight.endMs);
    this.closeTimelineAuras(this.currentFight, this.currentFight.endMs);
    this.pendingLandedSwings.clear();
    this.activeVoidPowerStacks.clear();
    this.activeTwinEmpowerment.clear();
    this.currentFight = null;
  }

  private seedTimelineAuras(fight: FightAccumulator) {
    for (const aura of this.globalAuras.values()) {
      if (!isPlayerGuid(aura.targetId) && !isOwnableUnitGuid(aura.targetId)) {
        continue;
      }
      const index = fight.auraWindows.push({
        sourceActorId: aura.sourceActorId,
        sourceUnitId: aura.sourceUnitId,
        targetId: aura.targetId,
        spellId: aura.spellId,
        auraType: aura.auraType,
        start: 0,
        end: 0,
        maxStacks: Math.max(1, aura.stacks),
      }) - 1;
      fight.activeAuraWindowIndexes.set(aura.key, index);
    }
  }

  private closeTimelineAuras(fight: FightAccumulator, timestampMs: number) {
    const end = Math.max(0, timestampMs - fight.startMs);
    for (const index of fight.activeAuraWindowIndexes.values()) {
      const window = fight.auraWindows[index];
      if (window) window.end = end;
    }
    fight.activeAuraWindowIndexes.clear();
  }

  private consumeAura(fields: string[], event: string, timestampMs: number) {
    const sourceGuid = fields[1];
    const destGuid = fields[5];
    const spellName = safeName(fields[10], "");
    const rawSpellId = fields[9] || spellName;
    if (!destGuid || !spellName) return;
    const auraSpellId = this.registerSpell(fields[9], fields[10]);
    this.consumeTimelineAura(fields, event, timestampMs, auraSpellId);
    const auraStarted =
      event === "SPELL_AURA_APPLIED" ||
      event === "SPELL_AURA_APPLIED_DOSE" ||
      event === "SPELL_AURA_REFRESH";
    const auraEnded = event === "SPELL_AURA_REMOVED";

    if (
      isPlayerGuid(sourceGuid) &&
      destGuid &&
      fields[12] === "DEBUFF"
    ) {
      const snapshotKey = `${sourceGuid}:${destGuid}:${auraSpellId}`;
      if (auraStarted) {
        const attribution = this.activeSupportAttribution.get(sourceGuid);
        this.periodicSupportSnapshots.set(
          snapshotKey,
          attribution ? { ...attribution } : null,
        );
      } else if (auraEnded) {
        this.periodicSupportSnapshots.delete(snapshotKey);
      }
    }

    if (isPlayerGuid(destGuid) && BOOST_AURA_PATTERN.test(spellName)) {
      const boostKey = `${destGuid}:${rawSpellId}`;
      if (auraStarted && !this.activeBoostAuras.has(boostKey)) {
        this.activeBoostAuras.add(boostKey);
        this.activeBoostCounts.set(
          destGuid,
          (this.activeBoostCounts.get(destGuid) ?? 0) + 1,
        );
      } else if (auraEnded && this.activeBoostAuras.delete(boostKey)) {
        this.activeBoostCounts.set(
          destGuid,
          Math.max(0, (this.activeBoostCounts.get(destGuid) ?? 1) - 1),
        );
      }
    }

    if (
      isPlayerGuid(destGuid) &&
      (auraSpellId === 49016 || /邪恶狂热|Hysteria/i.test(spellName))
    ) {
      const sourceActorId = this.resolveOwnerGuid(fields[1]);
      if (auraStarted && sourceActorId && sourceActorId !== destGuid) {
        this.activeSupportAttribution.set(destGuid, {
          sourceActorId,
          spellId: auraSpellId,
        });
        this.spellNames.set(-Math.abs(auraSpellId), spellName);
      } else if (auraEnded) {
        this.activeSupportAttribution.delete(destGuid);
      }
    }

    if (
      isPlayerGuid(destGuid) &&
      (auraSpellId === 66228 || /虚空之能|Nether Power/i.test(spellName))
    ) {
      if (event === "SPELL_AURA_APPLIED") {
        this.activeVoidPowerStacks.set(destGuid, 1);
      } else if (
        event === "SPELL_AURA_APPLIED_DOSE" ||
        event === "SPELL_AURA_REMOVED_DOSE"
      ) {
        this.activeVoidPowerStacks.set(
          destGuid,
          Math.max(1, numeric(fields[13])),
        );
      } else if (event === "SPELL_AURA_REMOVED") {
        this.activeVoidPowerStacks.delete(destGuid);
      }
    }

    if (
      isPlayerGuid(destGuid) &&
      /光明增效|黑暗增效|Empowered Light|Empowered Darkness/i.test(spellName)
    ) {
      if (auraStarted) {
        this.activeTwinEmpowerment.set(
          destGuid,
          /光明增效|Empowered Light/i.test(spellName) ? "light" : "dark",
        );
      } else if (auraEnded) {
        this.activeTwinEmpowerment.delete(destGuid);
      }
    }

    if (!this.currentFight) return;
    const metric = (Object.keys(AURA_PATTERNS) as AuraMetric[]).find((key) =>
      AURA_PATTERNS[key].test(spellName),
    );
    if (!metric) return;
    if (metric !== "demonic" && !isNpcGuid(destGuid)) return;
    if (metric === "demonic" && !isPlayerGuid(destGuid)) return;

    const auraKey = `${this.currentFight.id}:${metric}:${destGuid}:${rawSpellId}`;
    const metricKey = `${this.currentFight.id}:${metric}`;
    if (auraStarted && !this.activeAuras.has(auraKey)) {
      const activeCount = this.activeAuraCounts.get(metricKey) ?? 0;
      if (activeCount === 0) this.activeAuraStarts.set(metricKey, timestampMs);
      this.activeAuraCounts.set(metricKey, activeCount + 1);
      this.activeAuras.set(auraKey, {
        fightId: this.currentFight.id,
        metric,
      });
    } else if (auraEnded && this.activeAuras.delete(auraKey)) {
      const nextCount = Math.max(0, (this.activeAuraCounts.get(metricKey) ?? 1) - 1);
      this.activeAuraCounts.set(metricKey, nextCount);
      if (nextCount === 0) {
        const startedAt = this.activeAuraStarts.get(metricKey);
        if (startedAt !== undefined) {
          this.currentFight.auraMs[metric] += Math.max(0, timestampMs - startedAt);
        }
        this.activeAuraStarts.delete(metricKey);
      }
    }
  }

  private consumeTimelineAura(
    fields: string[],
    event: string,
    timestampMs: number,
    auraSpellId: number,
  ) {
    const sourceUnitId = fields[1];
    const targetId = fields[5];
    if (!targetId) return;
    const auraType = fields[12] === "DEBUFF" ? "DEBUFF" : "BUFF";
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(safeName(fields[2], ""));
    }
    const key = `${sourceUnitId || "0"}:${targetId}:${auraSpellId}`;
    const stackValue = Math.max(1, numeric(fields[13]));
    const applied =
      event === "SPELL_AURA_APPLIED" ||
      event === "SPELL_AURA_APPLIED_DOSE" ||
      event === "SPELL_AURA_REFRESH";
    const removed = event === "SPELL_AURA_REMOVED";

    let state = this.globalAuras.get(key);
    if (applied) {
      if (!state) {
        state = {
          key,
          sourceActorId,
          sourceUnitId,
          targetId,
          spellId: auraSpellId,
          auraType,
          stacks: stackValue,
        };
        this.globalAuras.set(key, state);
      } else {
        state.stacks = Math.max(state.stacks, stackValue);
      }

      if (
        this.currentFight &&
        !this.currentFight.activeAuraWindowIndexes.has(key)
      ) {
        const index = this.currentFight.auraWindows.push({
          sourceActorId,
          sourceUnitId,
          targetId,
          spellId: auraSpellId,
          auraType,
          start: this.timelineOffset(timestampMs),
          end: 0,
          maxStacks: stackValue,
        }) - 1;
        this.currentFight.activeAuraWindowIndexes.set(key, index);
      } else if (this.currentFight) {
        const index = this.currentFight.activeAuraWindowIndexes.get(key);
        const window = index === undefined ? undefined : this.currentFight.auraWindows[index];
        if (window) window.maxStacks = Math.max(window.maxStacks, stackValue);
      }
      return;
    }

    if (event === "SPELL_AURA_REMOVED_DOSE") {
      if (state) state.stacks = Math.max(1, stackValue);
      return;
    }

    if (removed) {
      this.globalAuras.delete(key);
      if (!this.currentFight) return;
      const index = this.currentFight.activeAuraWindowIndexes.get(key);
      if (index !== undefined) {
        const window = this.currentFight.auraWindows[index];
        if (window) window.end = this.timelineOffset(timestampMs);
        this.currentFight.activeAuraWindowIndexes.delete(key);
      }
    }
  }

  private closeAurasForFight(fight: FightAccumulator, timestampMs: number) {
    for (const metric of Object.keys(fight.auraMs) as AuraMetric[]) {
      const metricKey = `${fight.id}:${metric}`;
      const startedAt = this.activeAuraStarts.get(metricKey);
      if (startedAt !== undefined) {
        fight.auraMs[metric] += Math.max(0, timestampMs - startedAt);
      }
      this.activeAuraStarts.delete(metricKey);
      this.activeAuraCounts.delete(metricKey);
    }
    for (const [auraKey, active] of this.activeAuras.entries()) {
      if (active.fightId === fight.id) this.activeAuras.delete(auraKey);
    }
  }

  private consumeDamage(fields: string[], event: string, timestampMs: number) {
    const sourceGuid = fields[1];
    const sourceName = isPlayerGuid(sourceGuid)
      ? playerName(fields[2])
      : safeName(fields[2], "未知来源");
    const sourceFlags = fields[3];
    const destGuid = fields[5];
    const destName = isPlayerGuid(destGuid)
      ? playerName(fields[6])
      : safeName(fields[6], "未知目标");
    const destFlags = fields[7];
    const payload = parseDamagePayload(fields, event);
    this.advancedLogging ||= payload.advanced;
    const amount = payload.amount;
    const rankingAmount = amount + payload.absorbed;
    const timelineSpellId =
      event === "SWING_DAMAGE"
        ? 0
        : event === "ENVIRONMENTAL_DAMAGE"
          ? -2
          : this.registerSpell(fields[9], fields[10]);

    let sourceOwnerGuid = this.resolveOwnerGuid(sourceGuid);
    if (!sourceOwnerGuid && isOwnableUnitGuid(sourceGuid)) {
      sourceOwnerGuid = this.resolveOwnerByName(sourceName);
      if (sourceOwnerGuid) this.linkOwner(sourceGuid, sourceOwnerGuid);
    }

    if (
      !sourceOwnerGuid &&
      isPlayerGuid(destGuid) &&
      ((isNpcGuid(sourceGuid) && !isFriendlyUnit(sourceFlags)) ||
        event === "ENVIRONMENTAL_DAMAGE")
    ) {
      const targetActor = this.ensureActor(destGuid, destName);
      targetActor.damageTaken += amount;
      targetActor.seenInEncounter ||= Boolean(this.currentFight);
      const incomingEvent = this.addTimelineEvent({
        t: this.timelineOffset(timestampMs),
        kind: "incoming",
        sourceUnitId: sourceGuid,
        targetId: destGuid,
        spellId: timelineSpellId,
        amount,
        rawAmount: payload.rawAmount,
        overAmount: payload.overkill,
        absorbed: payload.absorbed,
        blocked: payload.blocked,
        resisted: payload.resisted,
        critical: payload.critical,
        glancing: payload.glancing,
        crushing: payload.crushing,
        periodic: event === "SPELL_PERIODIC_DAMAGE",
        snapshotUnitId: payload.snapshot?.unitId,
        hp: payload.snapshot?.hp,
        maxHp: payload.snapshot?.maxHp,
      });
      if (event === "SWING_DAMAGE" && payload.advanced && incomingEvent) {
        this.queueSwingEvent(timestampMs, sourceGuid, destGuid, {
          timestampMs,
          event: incomingEvent,
        });
      }
      if (incomingEvent && amount > 0) {
        this.lastIncomingByTarget.set(destGuid, incomingEvent);
      }
      if (this.currentFight?.puller === "待识别") {
        this.currentFight.puller = targetActor.name;
        this.currentFight.pullMethod = `${sourceName} 首次近战/技能命中`;
      }
    }

    if (!rankingAmount) return;
    if (!isDamageTarget(destGuid, destFlags)) return;

    let actorGuid = sourceGuid;
    let actorName = sourceName;
    let fromPet = false;
    if (sourceOwnerGuid && sourceOwnerGuid !== sourceGuid) {
      if (this.options.mergePets !== false) {
        actorGuid = sourceOwnerGuid;
        actorName = this.actors.get(sourceOwnerGuid)?.name ?? "宠物主人";
        fromPet = true;
      }
    } else if (
      !sourceOwnerGuid &&
      isOwnableUnitGuid(sourceGuid) &&
      isFriendlyUnit(sourceFlags)
    ) {
      this.unknownPetDamage += rankingAmount;
      const key = sourceGuid || sourceName;
      const source = this.unknownPetSources.get(key) ?? {
        name: sourceName,
        damage: 0,
      };
      source.damage += rankingAmount;
      this.unknownPetSources.set(key, source);
    }
    if (
      !actorGuid ||
      (!isPlayerGuid(actorGuid) &&
        !(this.options.mergePets === false && isOwnableUnitGuid(actorGuid)))
    ) {
      return;
    }

    const actor = this.ensureActor(actorGuid, actorName);
    actor.seenInEncounter ||= Boolean(this.currentFight);
    if (fromPet) actor.petDamage += rankingAmount;
    const spellName =
      event === "SWING_DAMAGE"
        ? fromPet
          ? "宠物近战"
          : "近战"
        : event === "ENVIRONMENTAL_DAMAGE"
          ? `环境伤害 · ${safeName(
              fields[payload.advanced ? 27 : 9],
              "未知环境",
            )}`
        : safeName(fields[10], event);
    const guardianOriginSpellId = fromPet
      ? this.guardianOriginSpells.get(sourceGuid)
      : undefined;
    const actorSpellId = guardianOriginSpellId
      ? -guardianOriginSpellId
      : event === "SWING_DAMAGE"
        ? fromPet
          ? -1
          : 0
        : timelineSpellId;
    if (event === "ENVIRONMENTAL_DAMAGE") {
      this.spellNames.set(-2, spellName);
    }
    const damageSchool =
      event === "SWING_DAMAGE" ? 1 : Number(fields[11]) || 0;
    const voidPowerStacks =
      this.currentFight?.encounterId === "633" &&
      !fromPet &&
      sourceGuid === actor.id &&
      (damageSchool & ~1) !== 0
        ? this.activeVoidPowerStacks.get(actor.id) ?? 0
        : 0;
    const voidNormalizedAmount = voidPowerStacks
      ? Math.round(rankingAmount / (1 + voidPowerStacks * 0.2))
      : rankingAmount;
    const normalizedDamage = Math.max(
      0,
      rankingAmount - voidNormalizedAmount,
    );
    if (this.currentFight && normalizedDamage > 0) {
      this.currentFight.normalizationByActor.set(
        actor.id,
        (this.currentFight.normalizationByActor.get(actor.id) ?? 0) +
          normalizedDamage,
      );
    }
    const twinEmpowerment =
      this.currentFight?.encounterId === "641" &&
      !fromPet &&
      sourceGuid === actor.id
        ? this.activeTwinEmpowerment.get(actor.id)
        : undefined;
    const twinBoostedTarget =
      (twinEmpowerment === "light" && /黑暗邪使/.test(destName)) ||
      (twinEmpowerment === "dark" && /光明邪使/.test(destName));
    const normalizedRankingAmount = twinBoostedTarget
      ? Math.round(voidNormalizedAmount / 2)
      : voidNormalizedAmount;
    const twinNormalizedDamage = Math.max(
      0,
      voidNormalizedAmount - normalizedRankingAmount,
    );
    if (this.currentFight && twinNormalizedDamage > 0) {
      this.currentFight.twinNormalizationByActor.set(
        actor.id,
        (this.currentFight.twinNormalizationByActor.get(actor.id) ?? 0) +
          twinNormalizedDamage,
      );
    }
    const periodicSupportKey = `${sourceGuid}:${destGuid}:${actorSpellId}`;
    const periodicSupportSnapshot =
      event === "SPELL_PERIODIC_DAMAGE" &&
      this.periodicSupportSnapshots.has(periodicSupportKey)
        ? this.periodicSupportSnapshots.get(periodicSupportKey)
        : undefined;
    const supportAttribution =
      !fromPet && sourceGuid === actor.id && (damageSchool & 1) === 1
        ? event === "SPELL_PERIODIC_DAMAGE" &&
          this.periodicSupportSnapshots.has(periodicSupportKey)
          ? periodicSupportSnapshot ?? undefined
          : this.activeSupportAttribution.get(actor.id)
        : undefined;
    const supportContribution = supportAttribution
      ? supportDamageContribution(payload, normalizedRankingAmount)
      : 0;
    const actorRankingAmount = Math.max(
      0,
      normalizedRankingAmount - supportContribution,
    );
    if (actorRankingAmount > 0) {
      actor.spells.set(
        actorSpellId,
        (actor.spells.get(actorSpellId) ?? 0) + actorRankingAmount,
      );
    }
    const supportActor =
      supportAttribution && supportContribution > 0
        ? this.ensureActor(
            supportAttribution.sourceActorId,
            this.actors.get(supportAttribution.sourceActorId)?.name ?? "未知玩家",
          )
        : undefined;
    const supportSpellId = supportAttribution
      ? -Math.abs(supportAttribution.spellId)
      : 0;
    if (supportActor && supportContribution > 0) {
      supportActor.seenInEncounter ||= Boolean(this.currentFight);
      supportActor.spells.set(
        supportSpellId,
        (supportActor.spells.get(supportSpellId) ?? 0) + supportContribution,
      );
    }
    if (event === "SWING_DAMAGE") this.inferActor(actor, spellName, event);

    if (this.currentFight) {
      if (actorRankingAmount > 0) {
        addToNestedMap(
          this.currentFight.actorTargets,
          actor.id,
          destName,
          actorRankingAmount,
        );
        addToActorSpellTargets(
          this.currentFight.actorSpellTargets,
          actor.id,
          actorSpellId,
          destName,
          actorRankingAmount,
        );
      }
      if (supportActor && supportContribution > 0) {
        addToNestedMap(
          this.currentFight.actorTargets,
          supportActor.id,
          destName,
          supportContribution,
        );
        addToActorSpellTargets(
          this.currentFight.actorSpellTargets,
          supportActor.id,
          supportSpellId,
          destName,
          supportContribution,
        );
      }
      this.currentFight.targets.set(
        destName,
        (this.currentFight.targets.get(destName) ?? 0) +
          normalizedRankingAmount,
      );
      if (destGuid) {
        this.currentFight.targetDamageByGuid.set(
          destGuid,
          (this.currentFight.targetDamageByGuid.get(destGuid) ?? 0) +
            normalizedRankingAmount,
        );
      }
      const damageEvent = this.addTimelineEvent({
        t: this.timelineOffset(timestampMs),
        kind: "damage",
        sourceActorId: actor.id,
        sourceUnitId: sourceGuid,
        targetId: destGuid,
        spellId: actorSpellId,
        amount,
        rawAmount: payload.rawAmount,
        overAmount: payload.overkill,
        absorbed: payload.absorbed,
        blocked: payload.blocked,
        resisted: payload.resisted,
        critical: payload.critical,
        glancing: payload.glancing,
        crushing: payload.crushing,
        periodic: event === "SPELL_PERIODIC_DAMAGE",
        pet: fromPet,
        snapshotUnitId: payload.snapshot?.unitId,
        hp: payload.snapshot?.hp,
        maxHp: payload.snapshot?.maxHp,
      });
      if (event === "SWING_DAMAGE" && payload.advanced && damageEvent) {
        this.queueSwingEvent(timestampMs, sourceGuid, destGuid, {
          timestampMs,
          event: damageEvent,
          actorId: actor.id,
          actorSpellId,
          targetName: destName,
          targetGuid: destGuid,
          fromPet,
          fight: this.currentFight,
          boosted: (this.activeBoostCounts.get(actor.id) ?? 0) > 0,
          twinBoosted: twinBoostedTarget,
          oldRankingAmount: rankingAmount,
          oldNormalizedAmount: normalizedRankingAmount,
          oldTwinAdjustment: twinNormalizedDamage,
          oldActorAmount: actorRankingAmount,
          supportActorId: supportActor?.id,
          supportSpellId: supportActor ? supportSpellId : undefined,
          oldSupportAmount: supportContribution,
        });
      }
      if (this.currentFight.puller === "待识别") {
        this.currentFight.puller = actor.name;
        this.currentFight.pullMethod = `${spellName} 首次造成有效伤害`;
      }
      if ((this.activeBoostCounts.get(actor.id) ?? 0) > 0) {
        addToNestedMap(
          this.currentFight.boostedActorTargets,
          actor.id,
          destName,
          normalizedRankingAmount,
        );
      }
      this.currentFight.endMs = timestampMs;
    } else {
      this.recordTrashActivity(timestampMs);
      if (actorRankingAmount > 0) {
        addToNestedMap(
          this.trashActorTargets,
          actor.id,
          destName,
          actorRankingAmount,
        );
      }
      if (supportActor && supportContribution > 0) {
        addToNestedMap(
          this.trashActorTargets,
          supportActor.id,
          destName,
          supportContribution,
        );
      }
      this.trashTargets.set(
        destName,
        (this.trashTargets.get(destName) ?? 0) + normalizedRankingAmount,
      );
    }
  }

  private queueSwingEvent(
    timestampMs: number,
    sourceGuid: string | undefined,
    destGuid: string | undefined,
    pending: PendingSwingEvent,
  ) {
    const key = `${sourceGuid || "0"}:${destGuid || "0"}`;
    const landed = this.pendingLandedSwings.get(key) ?? [];
    let landedIndex = -1;
    let closestLandedDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < landed.length; index += 1) {
      const delta = Math.abs(timestampMs - landed[index].timestampMs);
      if (delta > 250 || delta >= closestLandedDelta) continue;
      landedIndex = index;
      closestLandedDelta = delta;
    }
    if (landedIndex >= 0) {
      const [match] = landed.splice(landedIndex, 1);
      if (!landed.length) this.pendingLandedSwings.delete(key);
      if (match) this.applyLandedSwing(pending, match.payload);
      return;
    }

    const previous = this.pendingSwingEvents.get(key) ?? [];
    const events: PendingSwingEvent[] = [];
    for (const candidate of previous) {
      if (timestampMs - candidate.timestampMs <= 500) {
        events.push(candidate);
      } else {
        this.discardPendingSwing(candidate);
      }
    }
    events.push(pending);
    this.pendingSwingEvents.set(key, events);
  }

  private enrichSwingDamage(fields: string[], timestampMs: number) {
    const sourceGuid = fields[1];
    const destGuid = fields[5];
    const key = `${sourceGuid || "0"}:${destGuid || "0"}`;
    const events = this.pendingSwingEvents.get(key);
    const payload = parseDamagePayload(fields, "SWING_DAMAGE");
    if (!events?.length) {
      const landed = (this.pendingLandedSwings.get(key) ?? []).filter(
        (candidate) => timestampMs - candidate.timestampMs <= 500,
      );
      landed.push({ timestampMs, payload });
      this.pendingLandedSwings.set(key, landed);
      return;
    }
    let matchIndex = -1;
    let closestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < events.length; index += 1) {
      const delta = timestampMs - events[index].timestampMs;
      if (delta < -5 || delta > 250 || delta >= closestDelta) continue;
      matchIndex = index;
      closestDelta = delta;
    }
    if (matchIndex < 0) return;
    const [pending] = events.splice(matchIndex, 1);
    if (!events.length) this.pendingSwingEvents.delete(key);
    if (!pending) return;
    this.applyLandedSwing(pending, payload);
  }

  private applyLandedSwing(
    pending: PendingSwingEvent,
    payload: DamagePayload,
  ) {
    const event = pending.event;
    event.amount = payload.amount;
    event.rawAmount = payload.rawAmount;
    event.overAmount = payload.overkill;
    event.absorbed = payload.absorbed;
    event.blocked = payload.blocked;
    event.resisted = payload.resisted;
    event.critical = payload.critical;
    event.glancing = payload.glancing;
    event.crushing = payload.crushing;
    event.snapshotUnitId = payload.snapshot?.unitId;
    event.hp = payload.snapshot?.hp;
    event.maxHp = payload.snapshot?.maxHp;
    this.reconcileSwingContribution(pending, payload);
  }

  private discardPendingSwing(pending: PendingSwingEvent) {
    // The time-server Eagle guardian emits a preliminary SWING_DAMAGE after
    // it has already despawned. WCL only accepts that guardian's hit when the
    // matching target-side SWING_DAMAGE_LANDED exists. Other units can lack
    // the target-side mirror at encounter boundaries, so keep their source
    // event as the fallback.
    if (
      !pending.actorId ||
      !pending.event.sourceUnitId?.includes("-260758-")
    ) {
      return;
    }
    this.reconcileSwingContribution(pending, {
      amount: 0,
      landedAmount: 0,
      rawAmount: 0,
      overkill: 0,
      resisted: 0,
      blocked: 0,
      absorbed: 0,
      critical: false,
      glancing: false,
      crushing: false,
      advanced: true,
    });
    const events = pending.fight?.timelineEvents;
    if (!events) return;
    const index = events.indexOf(pending.event);
    if (index >= 0) events.splice(index, 1);
  }

  private discardUnconfirmedSwingEvents() {
    for (const events of this.pendingSwingEvents.values()) {
      for (const pending of events) this.discardPendingSwing(pending);
    }
    this.pendingSwingEvents.clear();
  }

  private reconcileSwingContribution(
    pending: PendingSwingEvent,
    payload: DamagePayload,
  ) {
    const {
      actorId,
      actorSpellId,
      targetName,
      targetGuid,
      fight,
    } = pending;
    if (
      !actorId ||
      actorSpellId === undefined ||
      !targetName ||
      pending.oldRankingAmount === undefined ||
      pending.oldNormalizedAmount === undefined ||
      pending.oldActorAmount === undefined
    ) {
      return;
    }

    const actor = this.actors.get(actorId);
    if (!actor) return;
    const landedSupportAttribution =
      !pending.fromPet && pending.event.sourceUnitId === actorId
        ? this.activeSupportAttribution.get(actorId)
        : undefined;
    const supportActorId =
      pending.supportActorId ?? landedSupportAttribution?.sourceActorId;
    const supportSpellId =
      pending.supportSpellId ??
      (landedSupportAttribution
        ? -Math.abs(landedSupportAttribution.spellId)
        : undefined);
    const rankingAmount = payload.amount + payload.absorbed;
    const normalizedAmount = pending.twinBoosted
      ? Math.round(rankingAmount / 2)
      : rankingAmount;
    const supportAmount = supportActorId
      ? supportDamageContribution(payload, normalizedAmount)
      : 0;
    const actorAmount = Math.max(0, normalizedAmount - supportAmount);
    const twinAdjustment = Math.max(0, rankingAmount - normalizedAmount);
    const rankingDelta = rankingAmount - pending.oldRankingAmount;
    const normalizedDelta = normalizedAmount - pending.oldNormalizedAmount;
    const actorDelta = actorAmount - pending.oldActorAmount;
    const supportDelta =
      supportAmount - (pending.oldSupportAmount ?? 0);
    const twinAdjustmentDelta =
      twinAdjustment - (pending.oldTwinAdjustment ?? 0);

    if (actorDelta) {
      actor.spells.set(
        actorSpellId,
        Math.max(0, (actor.spells.get(actorSpellId) ?? 0) + actorDelta),
      );
    }
    if (pending.fromPet && rankingDelta) {
      actor.petDamage = Math.max(0, actor.petDamage + rankingDelta);
    }

    const supportActor = supportActorId
      ? this.ensureActor(
          supportActorId,
          this.actors.get(supportActorId)?.name ?? "未知玩家",
        )
      : undefined;
    if (supportActor && supportSpellId !== undefined && supportDelta) {
      supportActor.spells.set(
        supportSpellId,
        Math.max(
          0,
          (supportActor.spells.get(supportSpellId) ?? 0) +
            supportDelta,
        ),
      );
    }

    if (fight) {
      if (actorDelta) {
        addToNestedMap(fight.actorTargets, actorId, targetName, actorDelta);
        addToActorSpellTargets(
          fight.actorSpellTargets,
          actorId,
          actorSpellId,
          targetName,
          actorDelta,
        );
      }
      if (
        supportActorId &&
        supportSpellId !== undefined &&
        supportDelta
      ) {
        addToNestedMap(
          fight.actorTargets,
          supportActorId,
          targetName,
          supportDelta,
        );
        addToActorSpellTargets(
          fight.actorSpellTargets,
          supportActorId,
          supportSpellId,
          targetName,
          supportDelta,
        );
      }
      if (normalizedDelta) {
        fight.targets.set(
          targetName,
          Math.max(0, (fight.targets.get(targetName) ?? 0) + normalizedDelta),
        );
        if (targetGuid) {
          fight.targetDamageByGuid.set(
            targetGuid,
            Math.max(
              0,
              (fight.targetDamageByGuid.get(targetGuid) ?? 0) +
                normalizedDelta,
            ),
          );
        }
        if (pending.boosted) {
          addToNestedMap(
            fight.boostedActorTargets,
            actorId,
            targetName,
            normalizedDelta,
          );
        }
      }
      if (twinAdjustmentDelta) {
        fight.twinNormalizationByActor.set(
          actorId,
          Math.max(
            0,
            (fight.twinNormalizationByActor.get(actorId) ?? 0) +
              twinAdjustmentDelta,
          ),
        );
      }
      return;
    }

    if (actorDelta) {
      addToNestedMap(this.trashActorTargets, actorId, targetName, actorDelta);
    }
    if (supportActorId && supportDelta) {
      addToNestedMap(
        this.trashActorTargets,
        supportActorId,
        targetName,
        supportDelta,
      );
    }
    if (normalizedDelta) {
      this.trashTargets.set(
        targetName,
        Math.max(
          0,
          (this.trashTargets.get(targetName) ?? 0) + normalizedDelta,
        ),
      );
    }
  }

  private consumeHeal(fields: string[], event: string, timestampMs: number) {
    const sourceUnitId = fields[1];
    const targetId = fields[5];
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(safeName(fields[2], ""));
      if (sourceActorId) this.linkOwner(sourceUnitId, sourceActorId);
    }
    if (!sourceActorId) return;

    const payload = parseHealPayload(fields);
    this.advancedLogging ||= payload.advanced;
    const healSpellId = this.registerSpell(fields[9], fields[10]);
    const actor = this.ensureActor(
      sourceActorId,
      isPlayerGuid(sourceUnitId)
        ? playerName(fields[2])
        : this.actors.get(sourceActorId)?.name ?? "宠物主人",
    );
    actor.seenInEncounter ||= Boolean(this.currentFight);
    actor.healingDone += payload.amount;
    actor.overhealing += payload.overheal;
    if (isPlayerGuid(targetId) && targetId !== sourceActorId) {
      actor.externalHealingDone += payload.amount;
    }
    actor.heals.set(
      healSpellId,
      (actor.heals.get(healSpellId) ?? 0) + payload.amount,
    );
    if (this.currentFight) {
      addToActorSpellAmounts(
        this.currentFight.actorHeals,
        actor.id,
        healSpellId,
        payload.amount,
      );
    }

    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "heal",
      sourceActorId,
      sourceUnitId,
      targetId,
      spellId: healSpellId,
      amount: payload.amount,
      rawAmount: payload.rawAmount,
      overAmount: payload.overheal,
      absorbed: payload.absorbed,
      critical: payload.critical,
      periodic: event === "SPELL_PERIODIC_HEAL",
      pet: sourceUnitId !== sourceActorId,
      snapshotUnitId: payload.snapshot?.unitId,
      hp: payload.snapshot?.hp,
      maxHp: payload.snapshot?.maxHp,
    });
  }

  private consumeAbsorb(fields: string[], timestampMs: number) {
    const targetId = fields[5];
    const absorberStart = isGuidToken(fields[9]) ? 9 : 12;
    const sourceUnitId = fields[absorberStart];
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(
        safeName(fields[absorberStart + 1], ""),
      );
    }
    if (!sourceActorId) return;
    this.captureUnitIdentity(sourceUnitId, fields[absorberStart + 1]);
    const absorbSpellId = this.registerSpell(
      fields[absorberStart + 4],
      fields[absorberStart + 5],
    );
    const amount = numeric(fields[absorberStart + 7]);
    if (!amount) return;
    const actor = this.ensureActor(
      sourceActorId,
      isPlayerGuid(sourceUnitId)
        ? playerName(fields[absorberStart + 1])
        : this.actors.get(sourceActorId)?.name ?? "宠物主人",
    );
    actor.absorbDone += amount;
    if (isPlayerGuid(targetId) && targetId !== sourceActorId) {
      actor.externalHealingDone += amount;
    }
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "absorb",
      sourceActorId,
      sourceUnitId,
      targetId,
      spellId: absorbSpellId,
      amount,
    });
  }

  private consumeHealAbsorbed(fields: string[], timestampMs: number) {
    const targetId = fields[5];
    const sourceUnitId = fields[12];
    const sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId) return;
    const healSpellId = this.registerSpell(fields[16], fields[17]);
    const amount = numeric(fields[19]);
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "heal",
      sourceActorId,
      sourceUnitId,
      targetId,
      spellId: healSpellId,
      amount: 0,
      rawAmount: amount,
      absorbed: amount,
    });
  }

  private consumeCast(fields: string[], event: string, timestampMs: number) {
    const sourceUnitId = fields[1];
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(safeName(fields[2], ""));
    }
    if (!sourceActorId && !isNpcGuid(sourceUnitId)) return;
    const castSpellId = this.registerSpell(fields[9], fields[10]);
    const targetId = fields[5];
    if (
      event === "SPELL_CAST_SUCCESS" &&
      isPlayerGuid(targetId) &&
      sourceActorId &&
      sourceActorId !== targetId &&
      (castSpellId === 49016 || /邪恶狂热|Hysteria/i.test(fields[10] ?? ""))
    ) {
      this.activeSupportAttribution.set(targetId, {
        sourceActorId,
        spellId: castSpellId,
      });
      this.spellNames.set(-Math.abs(castSpellId), safeName(fields[10], "邪恶狂热"));
    }
    const snapshot = parseAdvancedSnapshot(fields, 12);
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: event === "SPELL_CAST_START" ? "cast-start" : "cast",
      sourceActorId,
      sourceUnitId,
      targetId,
      spellId: castSpellId,
      pet: Boolean(sourceActorId && sourceUnitId !== sourceActorId),
      snapshotUnitId: snapshot?.unitId,
      hp: snapshot?.hp,
      maxHp: snapshot?.maxHp,
      resourceType: snapshot?.resourceType,
      resource: snapshot?.resource,
      resourceMax: snapshot?.resourceMax,
    });
  }

  private consumeCastFailed(
    fields: string[],
    timestampMs: number,
  ) {
    const sourceUnitId = fields[1];
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(safeName(fields[2], ""));
    }
    if (!sourceActorId && !isNpcGuid(sourceUnitId)) return;
    const castSpellId = this.registerSpell(fields[9], fields[10]);
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "cast-failed",
      sourceActorId,
      sourceUnitId,
      targetId: fields[5],
      spellId: castSpellId,
      missType: safeName(fields[12], "施法失败"),
      pet: Boolean(sourceActorId && sourceUnitId !== sourceActorId),
    });
  }

  private consumeMiss(fields: string[], event: string, timestampMs: number) {
    const sourceUnitId = fields[1];
    const sourceName = isPlayerGuid(sourceUnitId)
      ? playerName(fields[2])
      : safeName(fields[2], "未知来源");
    const sourceFlags = fields[3];
    const targetId = fields[5];
    const targetName = isPlayerGuid(targetId)
      ? playerName(fields[6])
      : safeName(fields[6], "未知目标");
    const targetFlags = fields[7];
    let sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId && isOwnableUnitGuid(sourceUnitId)) {
      sourceActorId = this.resolveOwnerByName(sourceName);
      if (sourceActorId) this.linkOwner(sourceUnitId, sourceActorId);
    }
    if (
      !sourceActorId &&
      !isPlayerGuid(targetId) &&
      !(isOwnableUnitGuid(sourceUnitId) && isFriendlyUnit(sourceFlags))
    ) {
      return;
    }
    const swing = event === "SWING_MISSED";
    const missSpellId = swing
      ? sourceActorId && sourceUnitId !== sourceActorId
        ? -1
        : 0
      : this.registerSpell(fields[9], fields[10]);
    const missType = safeName(fields[swing ? 9 : 12], "MISS");
    const mitigationIndex = swing ? 11 : 14;
    const mitigationAmount = numeric(fields[mitigationIndex]);
    const rawAmount =
      numeric(fields[mitigationIndex + 1]) || mitigationAmount;
    const fullyAbsorbed = missType === "ABSORB" && mitigationAmount > 0;
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "miss",
      sourceActorId,
      sourceUnitId,
      targetId,
      spellId: missSpellId,
      amount: fullyAbsorbed ? mitigationAmount : undefined,
      rawAmount: rawAmount || undefined,
      absorbed: missType === "ABSORB" ? mitigationAmount : undefined,
      blocked: missType === "BLOCK" ? mitigationAmount : undefined,
      resisted: missType === "RESIST" ? mitigationAmount : undefined,
      missType,
      periodic: event === "SPELL_PERIODIC_MISSED",
      pet: Boolean(sourceActorId && sourceUnitId !== sourceActorId),
    });

    // Advanced logs encode a fully absorbed offensive hit as *_MISSED with
    // ABSORB plus the attempted amount. WCL includes that event in Damage
    // Done, so retain its attack result while also adding it to the ranking
    // aggregates. Partial absorbs remain handled by regular damage events.
    if (!fullyAbsorbed || !isDamageTarget(targetId, targetFlags)) return;

    let actorGuid = sourceUnitId;
    let actorName = sourceName;
    let fromPet = false;
    if (sourceActorId && sourceActorId !== sourceUnitId) {
      if (this.options.mergePets !== false) {
        actorGuid = sourceActorId;
        actorName = this.actors.get(sourceActorId)?.name ?? "宠物主人";
        fromPet = true;
      }
    } else if (
      !sourceActorId &&
      isOwnableUnitGuid(sourceUnitId) &&
      isFriendlyUnit(sourceFlags)
    ) {
      this.unknownPetDamage += mitigationAmount;
      const key = sourceUnitId || sourceName;
      const source = this.unknownPetSources.get(key) ?? {
        name: sourceName,
        damage: 0,
      };
      source.damage += mitigationAmount;
      this.unknownPetSources.set(key, source);
    }
    if (
      !actorGuid ||
      (!isPlayerGuid(actorGuid) &&
        !(this.options.mergePets === false && isOwnableUnitGuid(actorGuid)))
    ) {
      return;
    }

    const actor = this.ensureActor(actorGuid, actorName);
    actor.seenInEncounter ||= Boolean(this.currentFight);
    if (fromPet) actor.petDamage += mitigationAmount;
    const damageSchool = swing ? 1 : Number(fields[11]) || 0;
    const periodicSupportKey = `${sourceUnitId}:${targetId}:${missSpellId}`;
    const supportAttribution =
      !fromPet && sourceUnitId === actor.id && (damageSchool & 1) === 1
        ? event === "SPELL_PERIODIC_MISSED" &&
          this.periodicSupportSnapshots.has(periodicSupportKey)
          ? this.periodicSupportSnapshots.get(periodicSupportKey) ?? undefined
          : this.activeSupportAttribution.get(actor.id)
        : undefined;
    const supportContribution = supportAttribution
      ? Math.min(mitigationAmount, Math.floor(mitigationAmount / 6))
      : 0;
    const actorRankingAmount = mitigationAmount - supportContribution;
    actor.spells.set(
      missSpellId,
      (actor.spells.get(missSpellId) ?? 0) + actorRankingAmount,
    );
    const supportActor =
      supportAttribution && supportContribution > 0
        ? this.ensureActor(
            supportAttribution.sourceActorId,
            this.actors.get(supportAttribution.sourceActorId)?.name ??
              "未知玩家",
          )
        : undefined;
    const supportSpellId = supportAttribution
      ? -Math.abs(supportAttribution.spellId)
      : 0;
    if (supportActor && supportContribution > 0) {
      supportActor.seenInEncounter ||= Boolean(this.currentFight);
      supportActor.spells.set(
        supportSpellId,
        (supportActor.spells.get(supportSpellId) ?? 0) + supportContribution,
      );
    }
    const spellName = this.spellNames.get(missSpellId) ?? `技能 ${missSpellId}`;
    this.inferActor(actor, spellName, event);

    if (this.currentFight) {
      addToNestedMap(
        this.currentFight.actorTargets,
        actor.id,
        targetName,
        actorRankingAmount,
      );
      addToActorSpellTargets(
        this.currentFight.actorSpellTargets,
        actor.id,
        missSpellId,
        targetName,
        actorRankingAmount,
      );
      if (supportActor && supportContribution > 0) {
        addToNestedMap(
          this.currentFight.actorTargets,
          supportActor.id,
          targetName,
          supportContribution,
        );
        addToActorSpellTargets(
          this.currentFight.actorSpellTargets,
          supportActor.id,
          supportSpellId,
          targetName,
          supportContribution,
        );
      }
      this.currentFight.targets.set(
        targetName,
        (this.currentFight.targets.get(targetName) ?? 0) + mitigationAmount,
      );
      if (targetId) {
        this.currentFight.targetDamageByGuid.set(
          targetId,
          (this.currentFight.targetDamageByGuid.get(targetId) ?? 0) +
            mitigationAmount,
        );
      }
      if ((this.activeBoostCounts.get(actor.id) ?? 0) > 0) {
        addToNestedMap(
          this.currentFight.boostedActorTargets,
          actor.id,
          targetName,
          mitigationAmount,
        );
      }
      this.currentFight.endMs = timestampMs;
    } else {
      this.recordTrashActivity(timestampMs);
      addToNestedMap(
        this.trashActorTargets,
        actor.id,
        targetName,
        actorRankingAmount,
      );
      if (supportActor && supportContribution > 0) {
        addToNestedMap(
          this.trashActorTargets,
          supportActor.id,
          targetName,
          supportContribution,
        );
      }
      this.trashTargets.set(
        targetName,
        (this.trashTargets.get(targetName) ?? 0) + mitigationAmount,
      );
    }
  }

  private consumeInterrupt(fields: string[], timestampMs: number) {
    const sourceUnitId = fields[1];
    const sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId) return;
    const interruptSpellId = this.registerSpell(fields[9], fields[10]);
    const interruptedSpellId = this.registerSpell(fields[12], fields[13]);
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "interrupt",
      sourceActorId,
      sourceUnitId,
      targetId: fields[5],
      spellId: interruptSpellId,
      extraSpellId: interruptedSpellId,
    });
  }

  private consumeDispel(fields: string[], timestampMs: number) {
    const sourceUnitId = fields[1];
    const sourceActorId = this.resolveOwnerGuid(sourceUnitId);
    if (!sourceActorId) return;
    const dispelSpellId = this.registerSpell(fields[9], fields[10]);
    const removedSpellId = this.registerSpell(fields[12], fields[13]);
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "dispel",
      sourceActorId,
      sourceUnitId,
      targetId: fields[5],
      spellId: dispelSpellId,
      extraSpellId: removedSpellId,
    });
  }

  private consumeResource(fields: string[], event: string, timestampMs: number) {
    const targetId = fields[5];
    if (!isPlayerGuid(targetId)) return;
    const resourceSpellId = this.registerSpell(fields[9], fields[10]);
    const snapshot = parseAdvancedSnapshot(fields, 12);
    const advanced = Boolean(snapshot) && fields.length > 33;
    const amountIndex = advanced ? 30 : 12;
    const amount = numeric(fields[amountIndex]);
    const drain = event.includes("DRAIN") || event === "SPELL_LEECH";
    this.addTimelineEvent({
      t: this.timelineOffset(timestampMs),
      kind: "resource",
      sourceActorId: this.resolveOwnerGuid(fields[1]),
      sourceUnitId: fields[1],
      targetId,
      spellId: resourceSpellId,
      amount: drain ? -amount : amount,
      overAmount: numeric(fields[amountIndex + 1]),
      resourceType: advanced
        ? signedNumeric(fields[amountIndex + 2])
        : signedNumeric(fields[amountIndex + 2]),
      resource: snapshot?.resource,
      resourceMax:
        snapshot?.resourceMax || numeric(fields[amountIndex + 3]),
      snapshotUnitId: snapshot?.unitId,
      hp: snapshot?.hp,
      maxHp: snapshot?.maxHp,
      periodic: event.includes("PERIODIC"),
    });
  }

  private consumeDeath(fields: string[], event: string, timestampMs: number) {
    const targetId = fields[5];
    if (!targetId) return;
    const time = this.timelineOffset(timestampMs);
    const recentIncoming = this.lastIncomingByTarget.get(targetId);
    const killingBlow =
      recentIncoming && time - recentIncoming.t >= 0 && time - recentIncoming.t <= 10_000
        ? recentIncoming
        : undefined;
    const instakill = event === "SPELL_INSTAKILL";
    // Hunter Feign Death emits UNIT_DIED while the player is still alive. A
    // real player death must have a recent incoming event (or an instakill).
    if (isPlayerGuid(targetId) && !instakill && !killingBlow) return;
    const sourceActorId = instakill
      ? this.resolveOwnerGuid(fields[1])
      : killingBlow?.sourceActorId;
    const deathSpellId = instakill
      ? this.registerSpell(fields[9], fields[10])
      : killingBlow?.spellId ?? 0;
    this.addTimelineEvent({
      t: time,
      kind: "death",
      sourceActorId,
      sourceUnitId: instakill ? fields[1] : killingBlow?.sourceUnitId,
      targetId,
      spellId: deathSpellId,
      amount: killingBlow?.amount,
      rawAmount: killingBlow?.rawAmount,
      overAmount: killingBlow?.overAmount,
      absorbed: killingBlow?.absorbed,
      blocked: killingBlow?.blocked,
      resisted: killingBlow?.resisted,
      critical: killingBlow?.critical,
      glancing: killingBlow?.glancing,
      crushing: killingBlow?.crushing,
    });
  }

  private recordTrashActivity(timestampMs: number) {
    const activityGapMs = 10_000;
    if (
      !this.trashWindowStart ||
      (this.trashLastDamageAt > 0 &&
        timestampMs - this.trashLastDamageAt > activityGapMs)
    ) {
      this.closeTrashActivity();
      this.trashWindowStart = timestampMs;
    }
    this.trashLastDamageAt = timestampMs;
  }

  private closeTrashActivity() {
    if (!this.trashWindowStart || !this.trashLastDamageAt) return;
    this.trashDurationMs += Math.max(
      1_000,
      this.trashLastDamageAt - this.trashWindowStart,
    );
    this.trashWindowStart = 0;
    this.trashLastDamageAt = 0;
  }

  private inferActor(actor: ActorAccumulator, spellName: string, event: string) {
    for (const rule of CLASS_RULES) {
      if (!rule.pattern.test(spellName)) continue;
      actor.classHints.set(
        rule.className,
        (actor.classHints.get(rule.className) ?? 0) + 1,
      );
      if (rule.style === "ranged") actor.rangedHint += 3;
      if (rule.style === "melee") actor.meleeHint += 3;
    }
    const strongestClass = [...actor.classHints.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0];
    if (strongestClass) actor.className = strongestClass;
    if (event === "SWING_DAMAGE") actor.meleeHint += 1;
    if (TANK_SPELLS.test(spellName)) actor.tankHint += 5;
    if (actor.className === "德鲁伊") {
      if (RANGED_DRUID_SPELLS.test(spellName)) actor.rangedHint += 4;
      if (MELEE_DRUID_SPELLS.test(spellName)) actor.meleeHint += 4;
    }
  }

  private snapshotFight(fight: FightAccumulator): FightAccumulator {
    const endMs = Math.max(this.lastTimestamp, fight.startMs + 1);
    const endOffset = Math.max(0, endMs - fight.startMs);
    const auraWindows = fight.auraWindows.map((window) => ({ ...window }));
    for (const index of fight.activeAuraWindowIndexes.values()) {
      const window = auraWindows[index];
      if (window) window.end = endOffset;
    }

    const auraMs = { ...fight.auraMs };
    (Object.keys(auraMs) as AuraMetric[]).forEach((metric) => {
      const metricKey = `${fight.id}:${metric}`;
      if ((this.activeAuraCounts.get(metricKey) ?? 0) <= 0) return;
      const startedAt = this.activeAuraStarts.get(metricKey);
      if (startedAt !== undefined) {
        auraMs[metric] += Math.max(0, endMs - startedAt);
      }
    });

    return {
      ...fight,
      endMs,
      auraMs,
      auraWindows,
      activeAuraWindowIndexes: new Map(fight.activeAuraWindowIndexes),
    };
  }

  finish(
    options: {
      snapshot?: boolean;
      sourceSize?: number;
      latestFightOnly?: boolean;
    } = {},
  ): CombatReport {
    const snapshot = options.snapshot ?? false;
    if (options.sourceSize !== undefined) {
      this.sourceSize = options.sourceSize;
    }
    if (!snapshot) {
      if (this.currentFight) this.finishCurrentFight(this.lastTimestamp, false);
      this.closeTrashActivity();
    }

    const incomingTotal = [...this.actors.values()].reduce(
      (sum, actor) => sum + actor.damageTaken,
      0,
    );
    const incomingLeaders = [...this.actors.values()]
      .sort((a, b) => b.damageTaken - a.damageTaken)
      .slice(0, 2)
      .map((actor) => actor.id);
    const maxIncomingDamage = Math.max(
      0,
      ...[...this.actors.values()].map((actor) => actor.damageTaken),
    );
    const totalExternalHealing = [...this.actors.values()].reduce(
      (sum, actor) => sum + actor.externalHealingDone,
      0,
    );

    const players: PlayerMeta[] = [...this.actors.values()]
      .filter(
        (actor) =>
          actor.spells.size > 0 ||
          actor.damageTaken > 0 ||
          actor.seenInEncounter ||
          actor.seenCombatantInfo,
      )
      .map((actor) => {
        const incomingShare =
          incomingTotal > 0 ? actor.damageTaken / incomingTotal : 0;
        const isTank =
          (incomingLeaders.includes(actor.id) &&
            incomingShare >= 0.12) ||
          (actor.tankHint >= 5 && incomingShare >= 0.08) ||
          (actor.tankHint >= 15 &&
            incomingShare >= 0.06 &&
            actor.damageTaken >= maxIncomingDamage * 0.45);
        const isHealer =
          !isTank &&
          actor.externalHealingDone >= 250_000 &&
          actor.externalHealingDone >= totalExternalHealing * 0.03;
        let combatRole: CombatRole = "unknown";
        if (isTank) combatRole = "tank";
        else if (isHealer) combatRole = "healer";
        else if (actor.rangedHint > actor.meleeHint) combatRole = "ranged";
        else if (actor.meleeHint > 0) combatRole = "melee";
        else if (
          ["猎人", "法师", "牧师", "萨满祭司", "术士"].includes(actor.className)
        ) {
          combatRole = "ranged";
        } else if (
          ["死亡骑士", "圣骑士", "潜行者", "战士"].includes(actor.className)
        ) {
          combatRole = "melee";
        }
        const talentPoints = selectedTalentPoints(actor);
        const talent = talentIdentity(actor.className, talentPoints, isTank);
        const role = talent.role ?? combatRole;

        return {
          id: actor.id,
          name: actor.name,
          className: actor.className,
          role,
          specialization: talent.specialization,
          talentPoints,
          roleSource: talent.roleSource ?? "combat",
          damageTaken: actor.damageTaken,
          petDamage: actor.petDamage,
          healingDone: actor.healingDone,
          overhealing: actor.overhealing,
          absorbDone: actor.absorbDone,
          topSpells: [...actor.spells.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([abilityId, damage]) => ({
              spellId: abilityId,
              name: this.spellNames.get(abilityId) ?? `技能 ${abilityId}`,
              damage,
            })),
          topHeals: [...actor.heals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([abilityId, healing]) => ({
              spellId: abilityId,
              name: this.spellNames.get(abilityId) ?? `技能 ${abilityId}`,
              healing,
            })),
        };
      });

    const reportFights =
      snapshot && options.latestFightOnly ? this.fights.slice(-1) : this.fights;
    const fights = reportFights.map((storedFight) => {
      const fight =
        snapshot && storedFight === this.currentFight
          ? this.snapshotFight(storedFight)
          : storedFight;
      const firstCombatEvent = fight.timelineEvents.find(
        (event) =>
          (event.kind === "damage" || event.kind === "incoming") &&
          (event.amount ?? 0) > 0,
      );
      // Some encounters fire ENCOUNTER_START during a long RP countdown. WCL
      // starts the visible fight at the actual pull, while millisecond-scale
      // differences are kept intact.
      const pullOffset =
        (firstCombatEvent?.t ?? 0) >= 2_000 ? firstCombatEvent?.t ?? 0 : 0;
      const effectiveStartMs = fight.startMs + pullOffset;
      const durationMs = Math.max(1, fight.endMs - effectiveStartMs);
      const timelineEvents = pullOffset
        ? fight.timelineEvents.map((event) => ({
            ...event,
            t: Math.max(0, event.t - pullOffset),
          }))
        : fight.timelineEvents;
      const auraWindows = pullOffset
        ? fight.auraWindows
            .map((window) => ({
              ...window,
              start: Math.max(0, window.start - pullOffset),
              end: Math.max(0, window.end - pullOffset),
            }))
            .filter((window) => window.end > window.start)
        : fight.auraWindows.filter((window) => window.end > window.start);
      const timelineTargets = [...fight.targetDamageByGuid.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, damage]) => ({
          id,
          name: this.unitNames.get(id) ?? "未知目标",
          damage,
        }));
      const exclusionRules = WCL_TARGET_EXCLUSIONS[fight.encounterId] ?? {};
      const excludedTargets = new Set(
        Object.keys(exclusionRules).filter(
          (target) => (fight.targets.get(target) ?? 0) > 0,
        ),
      );
      const rawActorTargets = nestedMapToRecord(fight.actorTargets);
      const rawTargets = mapToRecord(fight.targets);
      const filteredBoostedTargets = filterNestedTargets(
        fight.boostedActorTargets,
        excludedTargets,
      );
      return {
        id: fight.id,
        encounterId: fight.encounterId,
        name: fight.name,
        startMs: effectiveStartMs,
        endMs: fight.endMs,
        startLabel: formatClock(effectiveStartMs),
        durationMs,
        success: fight.success,
        puller: fight.puller,
        pullMethod: fight.pullMethod,
        actorTargets: filterNestedTargets(fight.actorTargets, excludedTargets),
        targets: filterTargets(fight.targets, excludedTargets),
        rawActorTargets,
        rawTargets,
        automaticExclusions: [...excludedTargets].map((target) => ({
          target,
          damage: fight.targets.get(target) ?? 0,
          reason: exclusionRules[target],
        })),
        automaticAdjustments: [
          ...[...fight.normalizationByActor.entries()].map(
            ([actorId, damage]) => ({
              key: `void-power-${actorId}`,
              label: "虚空之能收益正常化",
              damage,
              actorId,
              reason:
                "WCL P4.5+ 加拉克苏斯规则：按被偷取的虚空之能层数还原基础伤害",
            }),
          ),
          ...[...fight.twinNormalizationByActor.entries()].map(
            ([actorId, damage]) => ({
              key: `twin-empowerment-${actorId}`,
              label: "双子增效伤害正常化",
              damage,
              actorId,
              reason:
                "WCL 瓦格里双子规则：黑暗增效或光明增效期间的双倍伤害还原为基础伤害",
            }),
          ),
        ],
        actorSpellTargets: actorSpellTargetsToRecord(
          fight.actorSpellTargets,
          excludedTargets,
        ),
        actorHeals: actorSpellAmountsToRecord(fight.actorHeals),
        boostedByActor: Object.fromEntries(
          Object.entries(filteredBoostedTargets).map(([actorId, targets]) => [
            actorId,
            Object.values(targets).reduce((sum, damage) => sum + damage, 0),
          ]),
        ),
        auraMs: {
          armor: Math.min(durationMs, fight.auraMs.armor),
          faerie: Math.min(durationMs, fight.auraMs.faerie),
          demonic: Math.min(durationMs, fight.auraMs.demonic),
        },
        timeline: {
          events: timelineEvents,
          auras: auraWindows,
          targets: timelineTargets,
          primaryTargetId: timelineTargets[0]?.id,
        },
      };
    });

    const warnings: string[] = [];
    if (fights.length === 0) {
      warnings.push("未识别到 ENCOUNTER_START，当前日志只能按全局小怪查看。");
    }
    if (this.unknownPetDamage > 0) {
      const sourceNames = [...this.unknownPetSources.values()]
        .sort((a, b) => b.damage - a.damage)
        .slice(0, 3)
        .map((source) => source.name)
        .join("、");
      warnings.push(
        `部分友方宠物或守护者缺少主人信息，未计入玩家伤害（${Math.round(
          this.unknownPetDamage,
        ).toLocaleString("zh-CN")}${sourceNames ? `；来源：${sourceNames}` : ""}）。`,
      );
    }
    if (fights.some((fight) => Object.keys(fight.boostedByActor).length > 0)) {
      warnings.push("检测到临时增伤光环，可在规则面板中选择剔除。");
    }
    const unknownClassCount = players.filter(
      (player) => player.className === "未知",
    ).length;
    if (unknownClassCount > 0) {
      warnings.push(`${unknownClassCount} 名成员缺少足够的职业技能事件，职业暂标为未知。`);
    }
    warnings.push(
      "角色优先按 COMBATANT_INFO 天赋判定；已校准祖尔格拉布目标、十字军试炼增伤及高级日志落地事件，未覆盖的特殊 Boss 规则仍可能与 WCL 有差异。",
    );

    const windowStart =
      this.options.startTime ||
      (this.firstTimestamp ? formatClock(this.firstTimestamp) : "日志开始");
    const windowEnd =
      this.options.endTime ||
      (this.lastTimestamp ? formatClock(this.lastTimestamp) : "日志结束");
    const raidName =
      this.encounterZones.join(" · ") ||
      this.currentZone ||
      (fights[0]?.name ? "时光服团队日志" : "战斗日志");
    return {
      version: 1,
      parserVersion: "0.7.0",
      logVersion: this.logVersion || undefined,
      advancedLogging: this.advancedLogging,
      zones: [...this.encounterZones],
      spellNames: Object.fromEntries(
        [...this.spellNames.entries()].map(([id, name]) => [String(id), name]),
      ),
      unitNames: Object.fromEntries(this.unitNames.entries()),
      sourceName: this.sourceName,
      sourceSize: this.sourceSize,
      generatedAt: new Date().toISOString(),
      raidName,
      timeWindow: `${windowStart} — ${windowEnd}`,
      totalLines: this.totalLines,
      validEvents: this.validEvents,
      players,
      fights,
      trashActorTargets: nestedMapToRecord(this.trashActorTargets),
      trashTargets: mapToRecord(this.trashTargets),
      trashDurationMs: Math.max(
        1,
        this.trashDurationMs +
          (snapshot && this.trashWindowStart && this.trashLastDamageAt
            ? Math.max(1_000, this.trashLastDamageAt - this.trashWindowStart)
            : 0),
      ),
      warnings,
    };
  }

  get fightCount(): number {
    return this.fights.length;
  }
}

/**
 * Stateful parser used by the Web Worker and live-file mode. Chunks must be
 * appended in byte order; snapshots do not close an encounter that is still
 * in progress, so the same parser can continue consuming the growing file.
 */
export class CombatLogStreamParser {
  private readonly parser: CombatLogParser;
  private readonly decoder = new TextDecoder("utf-8");
  private carry = "";
  private bytesRead = 0;

  constructor(
    sourceName = "WoWCombatLog.txt",
    sourceSize = 0,
    options: ParseOptions = {},
  ) {
    this.parser = new CombatLogParser(sourceName, sourceSize, options);
  }

  append(chunk: Uint8Array): void {
    this.bytesRead += chunk.byteLength;
    const text = this.carry + this.decoder.decode(chunk, { stream: true });
    const lines = text.split(/\r?\n/);
    this.carry = lines.pop() ?? "";
    for (const line of lines) this.parser.consumeLine(line);
  }

  snapshot(
    sourceSize = this.bytesRead,
    options: { latestFightOnly?: boolean } = {},
  ): CombatReport {
    return this.parser.finish({
      snapshot: true,
      sourceSize,
      latestFightOnly: options.latestFightOnly,
    });
  }

  finish(sourceSize = this.bytesRead): CombatReport {
    this.carry += this.decoder.decode();
    if (this.carry.trim()) this.parser.consumeLine(this.carry);
    this.carry = "";
    return this.parser.finish({ sourceSize });
  }

  get totalLines(): number {
    return this.parser.totalLines;
  }

  get fightCount(): number {
    return this.parser.fightCount;
  }
}

export async function parseCombatLogFile(
  file: File,
  options: ParseOptions,
  onProgress?: ProgressCallback,
): Promise<CombatReport> {
  const parser = new CombatLogStreamParser(file.name, file.size, options);
  const reader = file.stream().getReader();
  let bytesRead = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    parser.append(value);
    onProgress?.(
      Math.min(96, Math.round((bytesRead / Math.max(file.size, 1)) * 96)),
      `正在本地解析 ${parser.totalLines.toLocaleString("zh-CN")} 行`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  onProgress?.(98, "正在生成伤害口径与团队结论");
  const report = parser.finish(file.size);
  onProgress?.(100, "解析完成");
  return report;
}

export function parseCombatLogText(
  text: string,
  options: ParseOptions = {},
  sourceName = "WoWCombatLog.txt",
): CombatReport {
  const sourceSize = new TextEncoder().encode(text).byteLength;
  const parser = new CombatLogParser(sourceName, sourceSize, options);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) parser.consumeLine(line);
  }
  return parser.finish();
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
    id: "p-healer-priest",
    name: "晨祷回声",
    className: "牧师",
    role: "healer",
    damageTaken: 128_000,
    petDamage: 0,
    healingDone: 31_860_000,
    overhealing: 8_420_000,
    absorbDone: 6_780_000,
    boss: 680_000,
    trash: 110_000,
    topSpells: [
      { name: "惩击", damage: 430_000 },
      { name: "神圣之火", damage: 250_000 },
    ],
    topHeals: [
      { name: "苦修", healing: 11_260_000 },
      { name: "真言术：盾", healing: 6_780_000 },
      { name: "快速治疗", healing: 6_210_000 },
      { name: "愈合祷言", healing: 5_480_000 },
      { name: "恢复", healing: 2_910_000 },
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

const DEMO_SPELL_IDS: Record<string, number> = {
  寒冰箭: 42842,
  冰枪术: 42914,
  暴风雪: 42940,
  暗影箭: 47809,
  腐蚀术: 47813,
  恶魔卫士: 30146,
  毁伤: 48666,
  毒伤: 57993,
  致命毒药: 57970,
  爆炸射击: 60053,
  自动射击: 75,
  狼: 2649,
  湮灭: 51425,
  冰霜打击: 55268,
  凛风冲击: 51411,
  闪电箭: 49238,
  熔岩爆裂: 60043,
  闪电链: 49271,
  嗜血: 23881,
  英勇打击: 47450,
  旋风斩: 1680,
  星火术: 48465,
  愤怒: 48461,
  月火术: 48463,
  神圣风暴: 53385,
  十字军打击: 35395,
  审判: 20271,
  精神鞭笞: 48156,
  "暗言术：痛": 48125,
  噬灵疫病: 48300,
  惩击: 48123,
  神圣之火: 48135,
  苦修: 53007,
  "真言术：盾": 48066,
  快速治疗: 48071,
  愈合祷言: 48113,
  恢复: 48068,
  盾牌猛击: 47488,
  复仇: 57823,
  正义之锤: 53595,
  奉献: 48819,
  复仇者之盾: 48827,
  破甲攻击: 47467,
  精灵之火: 770,
  暗影易伤: 17800,
  冰冷之爪: 50887,
  月蚀: 48517,
  急速射击: 3045,
  冰冷血脉: 12472,
  复仇之怒: 31884,
  能量灌注: 10060,
  切割: 5171,
  元素掌握: 16166,
  恶魔变形: 47241,
  死亡之愿: 12292,
  盾墙: 871,
  神圣保护: 498,
  专注意志: 45242,
};

export function createDemoReport(): CombatReport {
  const start = new Date("2026-04-05T20:08:00+08:00").getTime();
  let cursor = start;
  const weightSum = DEMO_FIGHTS.reduce(
    (sum, _, index) => sum + 1 + index * 0.055,
    0,
  );
  const spellNames: Record<string, string> = {
    "0": "近战",
    "-1": "宠物近战",
    "-2": "环境伤害",
  };
  const unitNames: Record<string, string> = Object.fromEntries(
    DEMO_PLAYER_SEEDS.map((player) => [player.id, player.name]),
  );
  const demoSpellIds = new Map<string, number>();
  let nextSpellId = 700_000;
  const getDemoSpellId = (name: string, preferredId?: number) => {
    const resolvedPreferredId = preferredId ?? DEMO_SPELL_IDS[name];
    const cacheKey = `${name}:${resolvedPreferredId ?? "generated"}`;
    const current = demoSpellIds.get(cacheKey);
    if (current !== undefined) return current;
    const id = resolvedPreferredId ?? nextSpellId;
    if (resolvedPreferredId === undefined) nextSpellId += 1;
    demoSpellIds.set(cacheKey, id);
    spellNames[String(id)] = name;
    return id;
  };
  const burstAuraNames: Partial<Record<WowClass, string>> = {
    死亡骑士: "冰冷之爪",
    德鲁伊: "月蚀",
    猎人: "急速射击",
    法师: "冰冷血脉",
    圣骑士: "复仇之怒",
    牧师: "能量灌注",
    潜行者: "切割",
    萨满祭司: "元素掌握",
    术士: "恶魔变形",
    战士: "死亡之愿",
  };
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
      const addShare =
        index === 5
          ? 0.09
          : 0.035 + ((playerIndex + index) % 4) * 0.012;
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

    const bossId = `demo-boss-${index + 1}`;
    const addId = `demo-add-${index + 1}`;
    unitNames[bossId] = seed.name;
    unitNames[addId] = seed.add;
    const bossMaxHp = Math.max(1, Math.round(targets[seed.name] * 1.035));
    const addMaxHp = Math.max(1, Math.round(targets[seed.add] * 1.08));
    const events: CombatTimelineEvent[] = [];
    const auras: CombatAuraWindow[] = [];
    const bossHpAt = (time: number) =>
      Math.max(
        0,
        Math.round(
          bossMaxHp *
            (1 - Math.min(0.997, (time / Math.max(1, seed.duration)) * 0.997)),
        ),
      );

    const armorId = getDemoSpellId("破甲攻击");
    const faerieId = getDemoSpellId("精灵之火");
    const shadowVulnerabilityId = getDemoSpellId("暗影易伤");
    auras.push(
      {
        sourceActorId: "p-tank-warrior",
        sourceUnitId: "p-tank-warrior",
        targetId: bossId,
        spellId: armorId,
        auraType: "DEBUFF",
        start: Math.round(seed.duration * 0.012),
        end: Math.round(seed.duration * seed.armor),
        maxStacks: 5,
      },
      {
        sourceActorId: "p-druid",
        sourceUnitId: "p-druid",
        targetId: bossId,
        spellId: faerieId,
        auraType: "DEBUFF",
        start: Math.round(seed.duration * 0.025),
        end: Math.round(seed.duration * seed.faerie),
        maxStacks: 1,
      },
      {
        sourceActorId: "p-warlock",
        sourceUnitId: "p-warlock",
        targetId: bossId,
        spellId: shadowVulnerabilityId,
        auraType: "DEBUFF",
        start: Math.round(seed.duration * 0.08),
        end: Math.round(seed.duration * 0.88),
        maxStacks: 5,
      },
    );

    const bloodlustId = getDemoSpellId("嗜血", 2825);
    DEMO_PLAYER_SEEDS.forEach((player, playerIndex) => {
      auras.push({
        sourceActorId: "p-shaman",
        sourceUnitId: "p-shaman",
        targetId: player.id,
        spellId: bloodlustId,
        auraType: "BUFF",
        start: Math.round(seed.duration * 0.055),
        end: Math.min(
          seed.duration,
          Math.round(seed.duration * 0.055) + 40_000,
        ),
        maxStacks: 1,
      });
      const roleAura =
        player.role === "tank"
          ? player.className === "战士"
            ? "盾墙"
            : "神圣保护"
          : player.role === "healer"
            ? "专注意志"
            : burstAuraNames[player.className] ?? "战斗专注";
      const roleAuraId = getDemoSpellId(roleAura);
      const firstStart =
        Math.round(seed.duration * (0.16 + (playerIndex % 3) * 0.015));
      auras.push({
        sourceActorId: player.id,
        sourceUnitId: player.id,
        targetId: player.id,
        spellId: roleAuraId,
        auraType: "BUFF",
        start: firstStart,
        end: Math.min(
          seed.duration,
          firstStart + (player.role === "tank" ? 12_000 : 20_000),
        ),
        maxStacks: 1,
      });
      if (player.role !== "tank") {
        const secondStart = Math.round(seed.duration * 0.68);
        auras.push({
          sourceActorId: player.id,
          sourceUnitId: player.id,
          targetId: player.id,
          spellId: roleAuraId,
          auraType: "BUFF",
          start: secondStart,
          end: Math.min(seed.duration, secondStart + 18_000),
          maxStacks: 1,
        });
      }
    });

    DEMO_PLAYER_SEEDS.forEach((player, playerIndex) => {
      const bossDamage = actorTargets[player.id]?.[seed.name] ?? 0;
      const addDamage = actorTargets[player.id]?.[seed.add] ?? 0;
      const topTotal = Math.max(
        1,
        player.topSpells.reduce((sum, spell) => sum + spell.damage, 0),
      );
      let distributedBossDamage = 0;

      player.topSpells.forEach((spell, spellIndex) => {
        const spellTotal =
          spellIndex === player.topSpells.length - 1
            ? bossDamage - distributedBossDamage
            : Math.round(bossDamage * (spell.damage / topTotal));
        distributedBossDamage += spellTotal;
        const hitCount = spellIndex === 0 ? 6 : 4;
        const periodic =
          /月火|腐蚀|毒药|暴风雪|奉献|暗言术|疾病|诅咒|灼烧/i.test(
            spell.name,
          );
        const fromPet = /狼|恶魔卫士|宠物|召唤/i.test(spell.name);
        const sourceUnitId = fromPet ? `demo-pet-${player.id}` : player.id;
        if (fromPet) unitNames[sourceUnitId] = `${player.name}的宠物`;
        const id = getDemoSpellId(spell.name);
        let distributedSpellDamage = 0;

        for (let hit = 0; hit < hitCount; hit += 1) {
          const amount =
            hit === hitCount - 1
              ? spellTotal - distributedSpellDamage
              : Math.round(spellTotal / hitCount);
          distributedSpellDamage += amount;
          const ordinal = spellIndex * 7 + hit + 1;
          const spread = ordinal / (player.topSpells.length * 7 + 1);
          const jitter = (playerIndex * 173 + hit * 79) % 850;
          const time = Math.min(
            seed.duration - 450,
            Math.max(
              450,
              Math.round(1_000 + spread * (seed.duration - 2_000) + jitter),
            ),
          );
          if (!periodic && !fromPet) {
            events.push({
              t: Math.max(0, time - 1_250),
              kind: "cast",
              sourceActorId: player.id,
              sourceUnitId: player.id,
              targetId: bossId,
              spellId: id,
            });
          }
          events.push({
            t: time,
            kind: "damage",
            sourceActorId: player.id,
            sourceUnitId,
            targetId: bossId,
            spellId: id,
            amount,
            rawAmount: Math.round(amount * 1.03),
            critical: (hit + spellIndex + playerIndex) % 4 === 0,
            periodic,
            pet: fromPet,
            snapshotUnitId: bossId,
            hp: bossHpAt(time),
            maxHp: bossMaxHp,
          });
        }
      });

      if (addDamage > 0) {
        const addTime = Math.min(
          seed.duration - 800,
          Math.round(seed.duration * (0.42 + (playerIndex % 4) * 0.025)),
        );
        const addSpell = player.topSpells[0];
        events.push({
          t: addTime,
          kind: "damage",
          sourceActorId: player.id,
          sourceUnitId: player.id,
          targetId: addId,
          spellId: getDemoSpellId(addSpell?.name ?? "近战"),
          amount: addDamage,
          rawAmount: addDamage,
          critical: playerIndex % 3 === 0,
          snapshotUnitId: addId,
          hp: Math.max(0, addMaxHp - Math.round(addMaxHp * 0.6)),
          maxHp: addMaxHp,
        });
      }

      if (player.role === "tank") {
        const incomingTotal = Math.round(player.damageTaken * weight);
        const incomingCount = 18;
        let distributedIncoming = 0;
        for (let hit = 0; hit < incomingCount; hit += 1) {
          const amount =
            hit === incomingCount - 1
              ? incomingTotal - distributedIncoming
              : Math.round(incomingTotal / incomingCount);
          distributedIncoming += amount;
          const time = Math.round(
            2_000 + ((hit + 1) / (incomingCount + 1)) * (seed.duration - 4_000),
          );
          const ability =
            hit % 5 === 0
              ? "穿刺"
              : hit % 7 === 0
                ? "虫群风暴"
                : "Boss 近战";
          const blocked = hit % 3 === 0 ? Math.round(amount * 0.28) : 0;
          const absorbed = hit % 4 === 0 ? Math.round(amount * 0.18) : 0;
          events.push({
            t: time,
            kind: "incoming",
            sourceUnitId: bossId,
            targetId: player.id,
            spellId: ability === "Boss 近战" ? 0 : getDemoSpellId(ability),
            amount,
            rawAmount: amount + blocked + absorbed,
            blocked,
            absorbed,
            snapshotUnitId: player.id,
            hp: Math.max(7_000, 52_000 - (hit % 5) * 7_100),
            maxHp: 52_000,
          });
        }
      }

      if (player.role === "healer") {
        const healSeeds = (player.topHeals ?? []).filter(
          (spell) => !/盾|吸收/i.test(spell.name),
        );
        const healTotal = Math.round((player.healingDone ?? 0) * weight);
        const healWeight = Math.max(
          1,
          healSeeds.reduce((sum, spell) => sum + spell.healing, 0),
        );
        const overhealRate =
          (player.overhealing ?? 0) /
          Math.max(1, (player.healingDone ?? 0) + (player.overhealing ?? 0));
        let distributedHealing = 0;
        healSeeds.forEach((heal, healIndex) => {
          const spellTotal =
            healIndex === healSeeds.length - 1
              ? healTotal - distributedHealing
              : Math.round(healTotal * (heal.healing / healWeight));
          distributedHealing += spellTotal;
          const castCount = 5;
          let distributedSpellHealing = 0;
          for (let cast = 0; cast < castCount; cast += 1) {
            const amount =
              cast === castCount - 1
                ? spellTotal - distributedSpellHealing
                : Math.round(spellTotal / castCount);
            distributedSpellHealing += amount;
            const target =
              DEMO_PLAYER_SEEDS[
                (cast * 3 + healIndex + playerIndex) % DEMO_PLAYER_SEEDS.length
              ];
            const time = Math.round(
              3_000 +
                ((healIndex * castCount + cast + 1) /
                  (healSeeds.length * castCount + 1)) *
                  (seed.duration - 6_000),
            );
            const id = getDemoSpellId(heal.name);
            const overAmount = Math.round(amount * overhealRate);
            events.push(
              {
                t: Math.max(0, time - 1_050),
                kind: "cast",
                sourceActorId: player.id,
                sourceUnitId: player.id,
                targetId: target.id,
                spellId: id,
              },
              {
                t: time,
                kind: "heal",
                sourceActorId: player.id,
                sourceUnitId: player.id,
                targetId: target.id,
                spellId: id,
                amount,
                rawAmount: amount + overAmount,
                overAmount,
                critical: (cast + healIndex) % 4 === 0,
                periodic: /恢复|愈合祷言/i.test(heal.name),
                snapshotUnitId: target.id,
                hp: 31_000 + ((cast + healIndex) % 4) * 3_200,
                maxHp: 48_000,
              },
            );
          }
        });

        const absorbTotal = Math.round((player.absorbDone ?? 0) * weight);
        const shieldId = getDemoSpellId("真言术：盾");
        const shieldCount = 8;
        let distributedAbsorb = 0;
        for (let shield = 0; shield < shieldCount; shield += 1) {
          const amount =
            shield === shieldCount - 1
              ? absorbTotal - distributedAbsorb
              : Math.round(absorbTotal / shieldCount);
          distributedAbsorb += amount;
          const target =
            DEMO_PLAYER_SEEDS[(shield * 2 + index) % DEMO_PLAYER_SEEDS.length];
          const time = Math.round(
            5_000 +
              ((shield + 1) / (shieldCount + 1)) * (seed.duration - 10_000),
          );
          events.push({
            t: time,
            kind: "absorb",
            sourceActorId: player.id,
            sourceUnitId: player.id,
            targetId: target.id,
            spellId: shieldId,
            amount,
          });
        }
      }
    });

    const bossAbilities = ["虫群风暴", "穿刺", "狂暴"];
    bossAbilities.forEach((ability, abilityIndex) => {
      const time = Math.round(
        seed.duration * (0.24 + abilityIndex * 0.23),
      );
      const abilityId = getDemoSpellId(ability);
      const target =
        abilityIndex % 2 === 0 ? "p-tank-warrior" : "p-tank-paladin";
      events.push(
        {
          t: Math.max(0, time - 1_800),
          kind: "cast-start",
          sourceUnitId: bossId,
          targetId: target,
          spellId: abilityId,
        },
        {
          t: time,
          kind: "cast",
          sourceUnitId: bossId,
          targetId: target,
          spellId: abilityId,
        },
      );
    });

    if (index === 0 || index === 3) {
      events.push({
        t: Math.round(seed.duration * 0.31),
        kind: "cast-failed",
        sourceActorId: "p-hunter",
        sourceUnitId: "p-hunter",
        targetId: bossId,
        spellId: getDemoSpellId("萨隆邪铁炸弹"),
        missType: "物品还没有准备好",
      });
    }
    events.push(
      {
        t: Math.round(seed.duration * 0.47),
        kind: "interrupt",
        sourceActorId: "p-rogue",
        sourceUnitId: "p-rogue",
        targetId: bossId,
        spellId: getDemoSpellId("脚踢"),
        extraSpellId: getDemoSpellId("虫群风暴"),
      },
      {
        t: Math.round(seed.duration * 0.58),
        kind: "dispel",
        sourceActorId: "p-healer-priest",
        sourceUnitId: "p-healer-priest",
        targetId: "p-tank-warrior",
        spellId: getDemoSpellId("驱散魔法"),
        extraSpellId: getDemoSpellId("致死创伤"),
      },
    );
    events.sort((a, b) => a.t - b.t);

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
      timeline: {
        events,
        auras,
        targets: [
          { id: bossId, name: seed.name, damage: targets[seed.name] },
          { id: addId, name: seed.add, damage: targets[seed.add] },
        ],
        primaryTargetId: bossId,
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
    parserVersion: "0.7.0",
    logVersion: 9,
    advancedLogging: true,
    zones: ["纳克萨玛斯"],
    spellNames,
    unitNames,
    sourceName: "WoWCombatLog_NAXX_P3_demo.txt",
    sourceSize: 247_800_000,
    generatedAt: new Date("2026-04-05T23:18:00+08:00").toISOString(),
    raidName: "纳克萨玛斯 · 时光服 P3",
    timeWindow: "20:08 — 23:18",
    totalLines: 832_675,
    validEvents: 211_100,
    players: DEMO_PLAYER_SEEDS.map((player) => ({
      id: player.id,
      name: player.name,
      className: player.className,
      role: player.role,
      damageTaken: player.damageTaken,
      petDamage: player.petDamage,
      healingDone: player.healingDone,
      overhealing: player.overhealing,
      absorbDone: player.absorbDone,
      topSpells: player.topSpells,
      topHeals: player.topHeals,
    })),
    fights,
    trashActorTargets,
    trashTargets,
    trashDurationMs: 3_240_000,
    warnings: ["四骑士的精灵之火覆盖率低于 90%。", "检测到 1 名玩家处于临时增伤光环。"],
  };
}
