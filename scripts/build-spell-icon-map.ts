import { readFile } from "node:fs/promises";
import {
  createDemoReport,
  parseCombatLogText,
  type CombatReport,
} from "../app/lib/combat-log";
import { buildOperationActions } from "../app/lib/operation-axis";

const WOWHEAD_TOOLTIP_ROOT =
  "https://nether.wowhead.com/wotlk/tooltip/spell";
const ICON_NAME_PATTERN = /^[a-z0-9_-]+$/i;
const CONCURRENCY = 20;

function collectOperationSpellIds(report: CombatReport, target: Set<number>) {
  const playerIds = new Set(report.players.map((player) => player.id));

  for (const fight of report.fights) {
    if (!fight.timeline) continue;

    for (const player of report.players) {
      for (const action of buildOperationActions(
        fight.timeline.events,
        player.id,
      )) {
        if (action.event.spellId > 0) target.add(action.event.spellId);
      }
    }

    for (const aura of fight.timeline.auras) {
      if (
        aura.spellId > 0 &&
        aura.auraType === "BUFF" &&
        playerIds.has(aura.targetId)
      ) {
        target.add(aura.spellId);
      }
    }
  }
}

async function fetchIconName(
  spellId: number,
  attempt = 0,
): Promise<string | null> {
  try {
    const response = await fetch(`${WOWHEAD_TOOLTIP_ROOT}/${spellId}`, {
      headers: {
        accept: "application/json",
        "user-agent": "curl/8.7.1",
      },
    });
    if (!response.ok) {
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        return fetchIconName(spellId, attempt + 1);
      }
      return null;
    }
    const payload = (await response.json()) as { icon?: unknown };
    return typeof payload.icon === "string" &&
      ICON_NAME_PATTERN.test(payload.icon)
      ? payload.icon.toLowerCase()
      : null;
  } catch {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      return fetchIconName(spellId, attempt + 1);
    }
    return null;
  }
}

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    throw new Error("请传入 WoWCombatLog.txt 路径");
  }

  const source = await readFile(sourcePath, "utf8");
  const report = parseCombatLogText(source, {}, sourcePath.split("/").at(-1));
  const spellIds = new Set<number>();
  collectOperationSpellIds(report, spellIds);
  collectOperationSpellIds(createDemoReport(), spellIds);

  const ids = [...spellIds].sort((a, b) => a - b);
  const icons = new Map<number, string>();
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const spellId = ids[cursor];
      cursor += 1;
      const iconName = await fetchIconName(spellId);
      if (iconName) icons.set(spellId, iconName);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()),
  );

  const lines = [
    "// Generated from the bundled demo and a verified advanced WotLK combat log.",
    "// Unknown Spell IDs still use the runtime resolver and text fallback.",
    "export const LOCAL_WOTLK_SPELL_ICONS: Readonly<Record<number, string>> = {",
    ...[...icons.entries()]
      .sort(([a], [b]) => a - b)
      .map(
        ([spellId, iconName]) => `  ${spellId}: ${JSON.stringify(iconName)},`,
      ),
    "};",
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

await main();
