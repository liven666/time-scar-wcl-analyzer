import assert from "node:assert/strict";
import test from "node:test";
import type { CombatReport } from "../app/lib/combat-log";
import {
  buildLocalComparisonProfile,
  buildWclComparisonProfile,
  comparePlayerProfiles,
  isSameBoss,
  localizeComparisonProfile,
} from "../app/lib/player-comparison";

const playerId = "Player-1";
const bossId = "Creature-1";

function localReport(): CombatReport {
  return {
    version: 1,
    parserVersion: "test",
    sourceName: "test.txt",
    sourceSize: 1,
    generatedAt: new Date(0).toISOString(),
    raidName: "祖尔格拉布",
    timeWindow: "test",
    totalLines: 1,
    validEvents: 1,
    players: [
      {
        id: playerId,
        name: "本地惩戒骑",
        className: "圣骑士",
        role: "melee",
        specialization: "惩戒",
        damageTaken: 0,
        petDamage: 0,
        topSpells: [{ spellId: 100, name: "十字军打击", damage: 10_000 }],
      },
    ],
    fights: [
      {
        id: "fight-7",
        encounterId: "14507",
        name: "高阶祭司温诺希斯",
        startMs: 0,
        endMs: 10_000,
        startLabel: "20:00",
        durationMs: 10_000,
        success: true,
        puller: "本地惩戒骑",
        pullMethod: "伤害",
        actorTargets: { [playerId]: { 高阶祭司温诺希斯: 10_000 } },
        targets: { 高阶祭司温诺希斯: 10_000 },
        actorSpellTargets: {
          [playerId]: { "100": { 高阶祭司温诺希斯: 10_000 } },
        },
        actorHeals: {},
        boostedByActor: {},
        auraMs: { armor: 0, faerie: 0, demonic: 0 },
        timeline: {
          primaryTargetId: bossId,
          targets: [{ id: bossId, name: "高阶祭司温诺希斯", damage: 10_000 }],
          auras: [
            {
              targetId: playerId,
              spellId: 200,
              auraType: "BUFF",
              start: 2_000,
              end: 6_000,
              maxStacks: 1,
            },
          ],
          events: [0, 1_500, 4_500, 8_000].flatMap((t, index) => [
            {
              t,
              kind: "cast" as const,
              sourceActorId: playerId,
              sourceUnitId: playerId,
              targetId: bossId,
              spellId: 100,
            },
            {
              t: t + 100,
              kind: "damage" as const,
              sourceActorId: playerId,
              sourceUnitId: playerId,
              targetId: bossId,
              spellId: 100,
              amount: 2_500,
              critical: index === 0,
            },
          ]),
        },
      },
    ],
    trashActorTargets: {},
    trashTargets: {},
    trashDurationMs: 0,
    warnings: [],
    spellNames: { "100": "十字军打击", "200": "复仇之怒" },
  };
}

test("builds a comparable local profile from one fight and actor", () => {
  const profile = buildLocalComparisonProfile(localReport(), "fight-7", playerId);
  assert.equal(profile.encounterId, "14507");
  assert.equal(profile.totalDamage, 10_000);
  assert.equal(profile.abilities.find((ability) => ability.id === "100")?.casts, 4);
  assert.equal(profile.abilities.find((ability) => ability.id === "100")?.critical, 1);
  assert.equal(profile.auras.find((aura) => aura.id === "200")?.uptimeMs, 4_000);
});

test("normalizes WCL events into the same comparison profile", () => {
  const profile = buildWclComparisonProfile(
    {
      reportCode: "ABC123",
      reportUrl: "https://www.warcraftlogs.com/reports/ABC123?fight=7&source=51",
      fightId: 7,
      encounterId: 14507,
      bossName: "高阶祭司温诺希斯",
      fightStartMs: 1_000,
      fightEndMs: 11_000,
      playerId: 51,
      playerName: "基准惩戒骑",
      className: "圣骑士",
      specialization: "惩戒",
      role: "dps",
      kill: true,
    },
    [
      { timestamp: 1_500, type: "cast", sourceID: 51, targetID: 9, abilityGameID: 100 },
      { timestamp: 1_600, type: "damage", sourceID: 51, targetID: 9, abilityGameID: 100, amount: 4_000, hitType: 2 },
      { timestamp: 2_000, type: "applybuff", sourceID: 51, targetID: 51, abilityGameID: 200 },
      { timestamp: 6_000, type: "removebuff", sourceID: 51, targetID: 51, abilityGameID: 200 },
    ],
    { "100": "十字军打击", "200": "复仇之怒" },
  );
  assert.equal(profile.totalDamage, 4_000);
  assert.equal(profile.abilities.find((ability) => ability.id === "100")?.casts, 1);
  assert.equal(profile.abilities.find((ability) => ability.id === "100")?.critical, 1);
  assert.equal(profile.auras.find((aura) => aura.id === "200")?.uptimeMs, 4_000);
});

test("matches Chinese and English names for the same boss", () => {
  assert.equal(
    isSameBoss(
      { bossName: "高阶祭司温诺希斯" },
      { bossName: "High Priest Venoxis" },
    ),
    true,
  );
});

test("localizes WCL-only abilities and buffs by stable spell ID", () => {
  const profile = buildWclComparisonProfile(
    {
      reportCode: "ZH123",
      reportUrl: "https://cn.titan.warcraftlogs.com/reports/ZH123?fight=7&source=7",
      fightId: 7,
      encounterId: 784,
      bossName: "High Priest Venoxis",
      fightStartMs: 1_000,
      fightEndMs: 11_000,
      playerId: 7,
      playerName: "基准惩戒骑",
      className: "Paladin",
      specialization: "Retribution",
      role: "dps",
      kill: true,
    },
    [
      { timestamp: 1_100, type: "damage", sourceID: 7, targetID: 9, abilityGameID: 1, amount: 2_000 },
      { timestamp: 2_000, type: "applybuff", sourceID: 7, targetID: 7, abilityGameID: 60439 },
      { timestamp: 5_000, type: "removebuff", sourceID: 7, targetID: 7, abilityGameID: 60439 },
      { timestamp: 6_000, type: "applybuff", sourceID: 7, targetID: 7, abilityGameID: 59620 },
      { timestamp: 9_000, type: "removebuff", sourceID: 7, targetID: 7, abilityGameID: 59620 },
    ],
    {
      "1": "Melee",
      "60439": "Loatheb's Shadow",
      "59620": "Berserk",
    },
  );

  assert.equal(profile.bossName, "高阶祭司温诺希斯");
  assert.equal(profile.abilities.find((ability) => ability.id === "1")?.name, "近战");
  assert.equal(profile.auras.find((aura) => aura.id === "60439")?.name, "洛欧塞布的阴影");
  assert.equal(profile.auras.find((aura) => aura.id === "59620")?.name, "狂暴");
});

test("prefers the uploaded Chinese spell dictionary for unknown WCL names", () => {
  const profile = localizeComparisonProfile(
    {
      version: 1,
      source: "wcl",
      fightId: "7",
      bossName: "High Priest Venoxis",
      playerId: "7",
      playerName: "基准角色",
      kill: true,
      durationMs: 10_000,
      activeMs: 9_000,
      totalDamage: 1_000,
      totalHealing: 0,
      totalAbsorb: 0,
      abilities: [
        {
          id: "999999",
          name: "Unknown Time Server Spell",
          damage: 1_000,
          healing: 0,
          absorb: 0,
          casts: 1,
          landed: 1,
          critical: 0,
          misses: 0,
          blocked: 0,
          dodged: 0,
          parried: 0,
          glanced: 0,
        },
      ],
      auras: [],
      actionTimestampsMs: [0],
    },
    { "999999": "时光服专属技能" },
  );

  assert.equal(profile.bossName, "高阶祭司温诺希斯");
  assert.equal(profile.abilities[0].name, "时光服专属技能");
});

test("separates repeatable cast gaps from single-fight crit variance", () => {
  const local = buildLocalComparisonProfile(localReport(), "fight-7", playerId);
  const benchmark = {
    ...local,
    source: "wcl" as const,
    playerId: "51",
    playerName: "基准惩戒骑",
    className: "Paladin",
    specialization: "Retribution",
    totalDamage: 15_000,
    activeMs: 9_700,
    actionTimestampsMs: [0, 1_500, 3_000, 4_500, 6_000, 7_500],
    abilities: local.abilities.map((ability) =>
      ability.id === "100"
        ? {
            ...ability,
            damage: 15_000,
            casts: 6,
            landed: 6,
            critical: 4,
          }
        : ability,
    ),
  };
  const result = comparePlayerProfiles(local, benchmark);
  assert.equal(result.sameBoss, true);
  assert.equal(result.sameSpecialization, true);
  assert.equal(Math.round(result.relativeGap * 100), 50);
  assert.equal(
    result.insights.some(
      (insight) => insight.kind === "execution" && insight.title.includes("十字军打击"),
    ),
    true,
  );
  assert.equal(
    result.insights.some((insight) => insight.kind === "variance"),
    true,
  );
});
