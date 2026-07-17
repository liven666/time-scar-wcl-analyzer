import assert from "node:assert/strict";
import test from "node:test";

import {
  CombatLogStreamParser,
  parseCombatLogText,
} from "../app/lib/combat-log";
import { buildOperationActions } from "../app/lib/operation-axis";

const PLAYER_FLAGS = "0x511";
const NPC_FLAGS = "0x10a48";
const RAID_FLAGS = "0x0";

function event(timestamp: string, payload: string, spaces = "  "): string {
  return `${timestamp}${spaces}${payload}`;
}

function advancedSnapshot(
  infoGuid: string,
  ownerGuid = "0000000000000000",
  hp = "100",
  maxHp = "100",
) {
  return [
    infoGuid,
    ownerGuid,
    hp,
    maxHp,
    "0",
    "0",
    "0",
    "0",
    "0",
    "-1",
    "0",
    "0",
    "0",
    "0",
    "0",
    "1",
    "0",
    "80",
  ].join(",");
}

test("parses real WoW combat-log event shapes and merges summoned pets", () => {
  const mageGuid = "Player-7451-00000001";
  const hunterGuid = "Player-7451-00000002";
  const tankGuid = "Player-7451-00000003";
  const petGuid = "Pet-0-0000-0000-00000-0000000001";
  const bossGuid = "Creature-0-0000-0000-00000-15956-0000000001";

  const lines = [
    event("7/12 20:08:00.000", 'ZONE_CHANGE,533,"纳克萨玛斯",4'),
    event("7/12 20:08:01.000", 'ENCOUNTER_START,1107,"阿努布雷坎",4,25'),
    event(
      "7/12 20:08:01.020",
      `SPELL_SUMMON,${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},${petGuid},"灰狼",${PLAYER_FLAGS},${RAID_FLAGS},883,"召唤宠物",1`,
    ),
    event(
      "7/12 20:08:01.040",
      `SPELL_AURA_APPLIED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},999001,"光明精华",1,BUFF`,
    ),
    event(
      "7/12 20:08:01.100",
      `SPELL_DAMAGE,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,1000,100,0,0,0,0,1,0,0`,
    ),
    event(
      "7/12 20:08:01.120",
      `RANGE_DAMAGE,${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},49052,"稳固射击",1,600,0,0,0,0,0,0,0,0`,
    ),
    event(
      "7/12 20:08:01.150",
      `SWING_DAMAGE,${petGuid},"灰狼",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},500,0,1,0,0,0,0,0,0`,
    ),
    event(
      "7/12 20:08:01.200",
      `SWING_DAMAGE,${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},${tankGuid},"测试坦克",${PLAYER_FLAGS},${RAID_FLAGS},1200,-1,1,0,0,0,0,0,0`,
    ),
    event(
      "7/12 20:08:02.000",
      `SPELL_AURA_APPLIED,${tankGuid},"测试坦克",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},7386,"破甲攻击",1,DEBUFF`,
    ),
    event(
      "7/12 20:08:03.000",
      `SPELL_AURA_APPLIED,${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},8647,"揭底",1,DEBUFF`,
    ),
    event(
      "7/12 20:08:04.000",
      `SPELL_AURA_APPLIED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},47240,"恶魔契约",32,BUFF`,
    ),
    event(
      "7/12 20:08:05.000",
      `SPELL_AURA_APPLIED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},47240,"恶魔契约",32,BUFF`,
    ),
    event(
      "7/12 20:08:06.000",
      `SPELL_AURA_REMOVED,${tankGuid},"测试坦克",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},7386,"破甲攻击",1,DEBUFF`,
    ),
    event(
      "7/12 20:08:07.000",
      `SPELL_AURA_REMOVED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},47240,"恶魔契约",32,BUFF`,
    ),
    event(
      "7/12 20:08:08.000",
      `SPELL_AURA_REMOVED,${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},8647,"揭底",1,DEBUFF`,
    ),
    event(
      "7/12 20:08:09.000",
      `SPELL_AURA_REMOVED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${hunterGuid},"测试猎人",${PLAYER_FLAGS},${RAID_FLAGS},47240,"恶魔契约",32,BUFF`,
    ),
    event(
      "7/12 20:08:09.500",
      `SPELL_AURA_REMOVED,${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},${mageGuid},"测试法师",${PLAYER_FLAGS},${RAID_FLAGS},999001,"光明精华",1,BUFF`,
    ),
    event("7/12 20:08:11.000", 'ENCOUNTER_END,1107,"阿努布雷坎",4,25,1'),
  ];

  const report = parseCombatLogText(lines.join("\n"), { mergePets: true });
  const fight = report.fights[0];
  const mage = report.players.find((player) => player.id === mageGuid);
  const hunter = report.players.find((player) => player.id === hunterGuid);
  const tank = report.players.find((player) => player.id === tankGuid);

  assert.equal(report.raidName, "纳克萨玛斯");
  assert.equal(report.parserVersion, "0.6.0");
  assert.equal(report.advancedLogging, false);
  assert.equal(fight.success, true);
  assert.equal(fight.durationMs, 10_000);
  assert.equal(fight.puller, "测试法师");
  assert.equal(fight.targets["阿努布雷坎"], 2_000);
  assert.equal(fight.actorTargets[mageGuid]["阿努布雷坎"], 900);
  assert.equal(fight.actorTargets[hunterGuid]["阿努布雷坎"], 1_100);
  assert.equal(fight.boostedByActor[mageGuid], 900);
  assert.equal(fight.auraMs.armor, 6_000);
  assert.equal(fight.auraMs.demonic, 5_000);
  assert.equal(mage?.className, "法师");
  assert.equal(hunter?.className, "猎人");
  assert.equal(hunter?.petDamage, 500);
  assert.equal(tank?.damageTaken, 1_200);
  assert.equal(
    report.warnings.some((warning) => warning.includes("缺少主人信息")),
    false,
  );
});

test("parses advanced combat log v9 snapshots and Creature guardians", () => {
  const mageGuid = "Player-6382-00000001";
  const hunterGuid = "Player-6382-00000002";
  const tankGuid = "Player-6382-00000003";
  const persistentPetGuid = "Pet-0-6504-0-9586-26125-010013CD32";
  const guardianGuid = "Creature-0-6407-309-33804-19668-0000000001";
  const inferredGuardianGuid = "Creature-0-6407-309-33804-19668-0000000004";
  const zgBossGuid = "Creature-0-6407-309-33804-14517-0000000002";
  const tocBossGuid = "Creature-0-6494-649-12345-34796-0000000003";

  const lines = [
    event(
      "7/10/2026 21:53:44.1198",
      "COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,3.80.1,PROJECT_ID,11",
    ),
    event("7/10/2026 21:54:00.0000", 'ZONE_CHANGE,309,"祖尔格拉布",4'),
    event(
      "7/10/2026 22:00:00.0000",
      'ENCOUNTER_START,14517,"高阶祭司耶克里克",4,25',
    ),
    event(
      "7/10/2026 22:00:00.0100",
      `COMBATANT_INFO,${tankGuid},1,0,0,0`,
    ),
    event(
      "7/10/2026 22:00:00.0500",
      `SPELL_PERIODIC_ENERGIZE,${mageGuid},"高级法师-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${mageGuid},"高级法师-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},57669,"恢复",8,48,0,0`,
    ),
    event(
      "7/10/2026 22:00:00.1000",
      `SPELL_DAMAGE,${mageGuid},"高级法师-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,${advancedSnapshot(zgBossGuid)},1200,2000,200,4,0,0,0,1,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:00:00.2000",
      `RANGE_DAMAGE,${hunterGuid},"高级猎人-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},49052,"稳固射击",1,${advancedSnapshot(zgBossGuid)},600,700,-1,1,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:00:00.2500",
      `SPELL_MISSED,${hunterGuid},"高级猎人-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},49052,"稳固射击",1,DODGE,nil,AOE`,
    ),
    event(
      "7/10/2026 22:00:00.3000",
      `SWING_DAMAGE,${persistentPetGuid},"魔暴龙",0x1111,${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},${advancedSnapshot(persistentPetGuid, hunterGuid)},350,400,-1,1,0,0,0,nil,nil,nil`,
    ),
    event(
      "7/10/2026 22:00:00.3010",
      `SWING_DAMAGE_LANDED,${persistentPetGuid},"魔暴龙",0x1111,${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},${advancedSnapshot(zgBossGuid)},350,400,-1,1,0,0,0,nil,nil,nil`,
    ),
    event(
      "7/10/2026 22:00:00.4000",
      `SPELL_SUMMON,${hunterGuid},"高级猎人-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${guardianGuid},"野兽守护者",0x1111,${RAID_FLAGS},900001,"召唤野兽",1`,
    ),
    event(
      "7/10/2026 22:00:00.5000",
      `SPELL_DAMAGE,${guardianGuid},"野兽守护者",0x1111,${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},900002,"撕咬",1,${advancedSnapshot(zgBossGuid)},500,600,-1,1,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:00:00.5500",
      `SPELL_DAMAGE,${inferredGuardianGuid},"野兽守护者",0x1111,${RAID_FLAGS},${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},900002,"撕咬",1,${advancedSnapshot(zgBossGuid)},100,120,-1,1,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:00:00.6000",
      `SPELL_DAMAGE,${zgBossGuid},"高阶祭司耶克里克",${NPC_FLAGS},${RAID_FLAGS},${tankGuid},"高级坦克-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},900003,"音爆",1,${advancedSnapshot(tankGuid)},1000,1500,-1,1,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:00:10.0000",
      'ENCOUNTER_END,14517,"高阶祭司耶克里克",4,25,1',
    ),
    event(
      "7/10/2026 23:00:00.0000",
      'ZONE_CHANGE,649,"十字军的试炼",4',
    ),
    event(
      "7/10/2026 23:01:00.0000",
      'ENCOUNTER_START,34796,"诺森德猛兽",4,25',
    ),
    event(
      "7/10/2026 23:01:00.1000",
      `SPELL_DAMAGE,${mageGuid},"高级法师-时光II理想国-CN",${PLAYER_FLAGS},${RAID_FLAGS},${tocBossGuid},"诺森德猛兽",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,${advancedSnapshot(tocBossGuid)},100,200,-1,4,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 23:01:02.0000",
      'ENCOUNTER_END,34796,"诺森德猛兽",4,25,1',
    ),
  ];

  const report = parseCombatLogText(lines.join("\n"), { mergePets: true });
  const zgFight = report.fights[0];
  const mage = report.players.find((player) => player.id === mageGuid);
  const hunter = report.players.find((player) => player.id === hunterGuid);
  const tank = report.players.find((player) => player.id === tankGuid);

  assert.equal(report.parserVersion, "0.6.0");
  assert.equal(report.logVersion, 9);
  assert.equal(report.advancedLogging, true);
  assert.deepEqual(report.zones, ["祖尔格拉布", "十字军的试炼"]);
  assert.equal(report.raidName, "祖尔格拉布 · 十字军的试炼");
  assert.equal(report.fights.length, 2);
  assert.equal(zgFight.targets["高阶祭司耶克里克"], 2_550);
  assert.equal(zgFight.actorTargets[mageGuid]["高阶祭司耶克里克"], 1_000);
  assert.equal(zgFight.actorTargets[hunterGuid]["高阶祭司耶克里克"], 1_550);
  assert.equal(mage?.name, "高级法师");
  assert.equal(mage?.className, "法师");
  assert.equal(hunter?.name, "高级猎人");
  assert.equal(hunter?.className, "猎人");
  assert.equal(hunter?.petDamage, 950);
  assert.equal(tank?.name, "高级坦克");
  assert.equal(tank?.damageTaken, 1_000);
  assert.equal(zgFight.timeline?.primaryTargetId, zgBossGuid);
  assert.equal(zgFight.timeline?.targets[0]?.name, "高阶祭司耶克里克");
  assert.equal(
    zgFight.timeline?.events.some(
      (timelineEvent) =>
        timelineEvent.kind === "damage" &&
        timelineEvent.sourceActorId === hunterGuid &&
        timelineEvent.pet === true,
    ),
    true,
  );
  assert.equal(
    zgFight.timeline?.events.find(
      (timelineEvent) =>
        timelineEvent.kind === "damage" &&
        timelineEvent.sourceActorId === mageGuid,
    )?.hp,
    100,
  );
  const mageDamageEvent = zgFight.timeline?.events.find(
    (timelineEvent) =>
      timelineEvent.kind === "damage" &&
      timelineEvent.sourceActorId === mageGuid,
  );
  assert.equal(mageDamageEvent?.amount, 1_000);
  assert.equal(mageDamageEvent?.rawAmount, 2_000);
  assert.equal(mageDamageEvent?.critical, true);
  assert.equal(
    zgFight.timeline?.events.some(
      (timelineEvent) =>
        timelineEvent.kind === "miss" &&
        timelineEvent.sourceActorId === hunterGuid &&
        timelineEvent.missType === "DODGE",
    ),
    true,
  );
  assert.equal(
    report.warnings.some((warning) => warning.includes("缺少主人信息")),
    false,
  );
});

test("builds healer, mitigation, aura and cast-failure replay events", () => {
  const healerGuid = "Player-6382-00000011";
  const mageGuid = "Player-6382-00000012";
  const tankGuid = "Player-6382-00000013";
  const bossGuid = "Creature-0-6407-309-33804-15956-0000000009";

  const lines = [
    event(
      "7/10/2026 22:10:00.0000",
      "COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,3.80.1,PROJECT_ID,11",
    ),
    event("7/10/2026 22:10:00.0100", 'ZONE_CHANGE,533,"纳克萨玛斯",4'),
    event(
      "7/10/2026 22:10:01.0000",
      'ENCOUNTER_START,15956,"阿努布雷坎",4,25',
    ),
    event(
      "7/10/2026 22:10:01.1000",
      `SPELL_DAMAGE,${mageGuid},"时间轴法师",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,${advancedSnapshot(
        bossGuid,
        "0000000000000000",
        "900000",
        "1000000",
      )},10000,12000,-1,4,0,0,0,1,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:10:01.2000",
      `SPELL_AURA_APPLIED,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},10060,"能量灌注",2,BUFF`,
    ),
    event(
      "7/10/2026 22:10:01.3000",
      `SPELL_CAST_SUCCESS,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS},2061,"快速治疗",2`,
    ),
    event(
      "7/10/2026 22:10:01.4000",
      `SPELL_HEAL,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS},2061,"快速治疗",2,${advancedSnapshot(
        tankGuid,
        "0000000000000000",
        "28000",
        "50000",
      )},380000,400000,30000,0,1,nil`,
    ),
    event(
      "7/10/2026 22:10:01.5000",
      `SPELL_ABSORBED,${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS},${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},48066,"真言术：盾",2,120000,0`,
    ),
    event(
      "7/10/2026 22:10:01.6000",
      `SPELL_CAST_FAILED,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},0000000000000000,nil,0x80000000,0x80000000,2061,"快速治疗",2,"尚未恢复"`,
    ),
    event(
      "7/10/2026 22:10:01.7000",
      `SPELL_CAST_START,${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS},900100,"虫群风暴",8`,
    ),
    event(
      "7/10/2026 22:10:01.7500",
      `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS}`,
    ),
    event(
      "7/10/2026 22:10:01.8000",
      `SPELL_DAMAGE,${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS},900200,"致命虫群",8,${advancedSnapshot(tankGuid)},50000,52000,-1,8,0,0,0,1,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:10:01.8100",
      `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${tankGuid},"复盘坦克",${PLAYER_FLAGS},${RAID_FLAGS}`,
    ),
    event(
      "7/10/2026 22:10:03.2000",
      `SPELL_AURA_REMOVED,${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},${healerGuid},"复盘牧师",${PLAYER_FLAGS},${RAID_FLAGS},10060,"能量灌注",2,BUFF`,
    ),
    event(
      "7/10/2026 22:10:06.0000",
      'ENCOUNTER_END,15956,"阿努布雷坎",4,25,1',
    ),
  ];

  const report = parseCombatLogText(lines.join("\n"), { mergePets: true });
  const healer = report.players.find((player) => player.id === healerGuid);
  const timeline = report.fights[0].timeline;

  assert.equal(healer?.role, "healer");
  assert.equal(healer?.healingDone, 350_000);
  assert.equal(healer?.overhealing, 30_000);
  assert.equal(healer?.absorbDone, 120_000);
  assert.equal(timeline?.primaryTargetId, bossGuid);
  assert.equal(
    timeline?.events.some(
      (timelineEvent) =>
        timelineEvent.kind === "cast-failed" &&
        timelineEvent.missType === "尚未恢复",
    ),
    true,
  );
  assert.equal(
    timeline?.events.some(
      (timelineEvent) =>
        timelineEvent.kind === "cast-start" &&
        timelineEvent.sourceUnitId === bossGuid &&
        timelineEvent.sourceActorId === undefined,
    ),
    true,
  );
  assert.equal(
    timeline?.events.find(
      (timelineEvent) => timelineEvent.kind === "heal",
    )?.hp,
    28_000,
  );
  const death = timeline?.events.find(
    (timelineEvent) => timelineEvent.kind === "death",
  );
  assert.equal(
    timeline?.events.filter((timelineEvent) => timelineEvent.kind === "death")
      .length,
    1,
  );
  assert.equal(death?.spellId, 900200);
  assert.equal(death?.amount, 50_000);
  assert.equal(death?.critical, true);
  assert.equal(
    timeline?.auras.find(
      (window) =>
        window.targetId === healerGuid &&
        report.spellNames?.[String(window.spellId)] === "能量灌注",
    )?.end,
    2_200,
  );
});

test("trims long encounter RP before the first real combat event", () => {
  const playerGuid = "Player-6382-00000021";
  const bossGuid = "Creature-0-6407-309-33804-15956-0000000021";
  const lines = [
    event(
      "7/10/2026 22:20:00.0000",
      'ENCOUNTER_START,15956,"阿努布雷坎",4,25',
    ),
    event(
      "7/10/2026 22:20:05.0000",
      `SPELL_DAMAGE,${playerGuid},"开怪法师",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,${advancedSnapshot(bossGuid)},1000,1200,-1,4,0,0,0,nil,nil,nil,ST`,
    ),
    event(
      "7/10/2026 22:20:10.0000",
      'ENCOUNTER_END,15956,"阿努布雷坎",4,25,1',
    ),
  ];

  const report = parseCombatLogText(lines.join("\n"), { mergePets: true });
  assert.equal(report.fights[0].durationMs, 5_000);
  assert.equal(report.fights[0].timeline?.events[0]?.t, 0);
});

test("accepts BOM and one-space separators, then applies a local time window", () => {
  const playerGuid = "Player-7451-00000009";
  const targetGuid = "Creature-0-0000-0000-00000-00001-0000000001";
  const log = [
    `\uFEFF${event(
      "7/12 20:00:00.000",
      `SPELL_DAMAGE,${playerGuid},"窗口法师",${PLAYER_FLAGS},${RAID_FLAGS},${targetGuid},"训练假人",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,100,0,0,0,0,0,0,0,0`,
      " ",
    )}`,
    event(
      "7/12 20:01:00.000",
      `SPELL_DAMAGE,${playerGuid},"窗口法师",${PLAYER_FLAGS},${RAID_FLAGS},${targetGuid},"训练假人",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,250,0,0,0,0,0,0,0,0`,
      " ",
    ),
  ].join("\n");

  const report = parseCombatLogText(log, {
    startTime: "20:01",
    endTime: "20:02",
  });

  assert.equal(report.totalLines, 2);
  assert.equal(report.validEvents, 1);
  assert.equal(report.trashTargets["训练假人"], 250);
  assert.equal(report.trashDurationMs, 1_000);
  assert.match(report.warnings.join(" "), /未识别到 ENCOUNTER_START/);
});

test("keeps an active encounter open across incremental live snapshots", () => {
  const playerGuid = "Player-7451-00000010";
  const bossGuid = "Creature-0-0000-0000-00000-15956-0000000010";
  const start = event(
    "7/12 20:10:00.000",
    'ENCOUNTER_START,15956,"阿努布雷坎",4,25',
  );
  const firstDamage = event(
    "7/12 20:10:01.000",
    `SPELL_DAMAGE,${playerGuid},"增量法师",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,1000,0,0,0,0,0,0,0,0`,
  );
  const secondDamage = event(
    "7/12 20:10:03.000",
    `SPELL_DAMAGE,${playerGuid},"增量法师",${PLAYER_FLAGS},${RAID_FLAGS},${bossGuid},"阿努布雷坎",${NPC_FLAGS},${RAID_FLAGS},42833,"火球术",4,2000,0,0,0,0,0,1,0,0`,
  );
  const end = event(
    "7/12 20:10:05.000",
    'ENCOUNTER_END,15956,"阿努布雷坎",4,25,1',
  );
  const encoder = new TextEncoder();
  const parser = new CombatLogStreamParser("live.txt", 0, {
    mergePets: true,
  });

  parser.append(encoder.encode(`${start}\n${firstDamage}\n`));
  const firstSnapshot = parser.snapshot();
  assert.equal(firstSnapshot.fights.length, 1);
  assert.equal(firstSnapshot.fights[0].success, false);
  assert.equal(firstSnapshot.fights[0].targets["阿努布雷坎"], 1_000);

  const splitAt = Math.floor(secondDamage.length / 2);
  parser.append(encoder.encode(secondDamage.slice(0, splitAt)));
  parser.append(encoder.encode(`${secondDamage.slice(splitAt)}\n${end}\n`));
  const finalSnapshot = parser.snapshot(undefined, { latestFightOnly: true });
  assert.equal(parser.fightCount, 1);
  assert.equal(finalSnapshot.fights.length, 1);
  assert.equal(finalSnapshot.fights[0].success, true);
  assert.equal(finalSnapshot.fights[0].targets["阿努布雷坎"], 3_000);
});

test("builds one-player operations from casts, effects and failures", () => {
  const playerId = "Player-7451-00000011";
  const bossId = "Creature-0-0000-0000-00000-15956-0000000011";
  const actions = buildOperationActions(
    [
      {
        t: 500,
        kind: "cast-start",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 42833,
      },
      {
        t: 2_500,
        kind: "cast",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 42833,
      },
      {
        t: 2_650,
        kind: "damage",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 42833,
        amount: 12_000,
      },
      {
        t: 3_000,
        kind: "cast-failed",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 30455,
        missType: "技能尚未准备好",
      },
      {
        t: 3_350,
        kind: "interrupt",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 2139,
      },
      {
        t: 3_500,
        kind: "damage",
        sourceActorId: playerId,
        sourceUnitId: playerId,
        targetId: bossId,
        spellId: 12654,
        amount: 800,
        periodic: true,
      },
      {
        t: 3_800,
        kind: "cast",
        sourceActorId: playerId,
        sourceUnitId: "Pet-0-0000000001",
        targetId: bossId,
        spellId: 900001,
        pet: true,
      },
    ],
    playerId,
  );

  const fireball = actions.find((action) => action.event.spellId === 42833);
  assert.equal(fireball?.status, "success");
  assert.equal(fireball?.startedAt, 500);
  assert.equal(fireball?.castDurationMs, 2_000);
  assert.equal(fireball?.effectAmount, 12_000);
  assert.equal(fireball?.effectCount, 1);
  assert.equal(
    actions.some(
      (action) =>
        action.status === "failed" &&
        action.reasons.includes("技能尚未准备好"),
    ),
    true,
  );
  assert.equal(
    actions.some(
      (action) =>
        action.status === "direct" && action.event.spellId === 2139,
    ),
    true,
  );
  assert.equal(
    actions.some((action) => action.event.spellId === 12654),
    false,
  );
  assert.equal(
    actions.some((action) => action.event.spellId === 900001),
    false,
  );
});
