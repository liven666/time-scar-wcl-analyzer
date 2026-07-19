const NAME_SEPARATOR_PATTERN = /[\s·'’`\-_:：()（）]/g;

function normalizedName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(NAME_SEPARATOR_PATTERN, "");
}

interface BossLocaleEntry {
  key: string;
  zh: string;
  aliases: string[];
}

const BOSS_LOCALES: BossLocaleEntry[] = [
  {
    key: "high-priestess-jeklik",
    zh: "高阶祭司耶克里克",
    aliases: ["High Priestess Jeklik", "Jeklik", "高阶祭司耶克里克"],
  },
  {
    key: "high-priest-venoxis",
    zh: "高阶祭司温诺希斯",
    aliases: ["High Priest Venoxis", "Venoxis", "高阶祭司温诺希斯"],
  },
  {
    key: "high-priestess-marli",
    zh: "高阶祭司玛尔里",
    aliases: ["High Priestess Mar'li", "High Priestess Marli", "Mar'li", "Marli", "高阶祭司玛尔里"],
  },
  {
    key: "bloodlord-mandokir",
    zh: "血领主曼多基尔",
    aliases: ["Bloodlord Mandokir", "Mandokir", "血领主曼多基尔"],
  },
  {
    key: "high-priest-thekal",
    zh: "高阶祭司塞卡尔",
    aliases: ["High Priest Thekal", "Thekal", "高阶祭司塞卡尔"],
  },
  {
    key: "high-priestess-arlokk",
    zh: "高阶祭司娅尔罗",
    aliases: ["High Priestess Arlokk", "Arlokk", "高阶祭司娅尔罗"],
  },
  {
    key: "jindo-the-hexxer",
    zh: "妖术师金度",
    aliases: ["Jin'do the Hexxer", "Jindo the Hexxer", "Jin'do", "Jindo", "妖术师金度"],
  },
  {
    key: "hakkar",
    zh: "哈卡",
    aliases: ["Hakkar", "Hakkar the Soulflayer", "哈卡"],
  },
  {
    key: "gahzranka",
    zh: "加兹兰卡",
    aliases: ["Gahz'ranka", "Gahzranka", "加兹兰卡"],
  },
  {
    key: "grilek",
    zh: "格里雷克",
    aliases: ["Gri'lek", "Grilek", "格里雷克"],
  },
  {
    key: "hazzarah",
    zh: "哈扎拉尔",
    aliases: ["Hazza'rah", "Hazzarah", "哈扎拉尔"],
  },
  {
    key: "renataki",
    zh: "雷纳塔基",
    aliases: ["Renataki", "雷纳塔基"],
  },
  {
    key: "wushoolay",
    zh: "乌苏雷",
    aliases: ["Wushoolay", "乌苏雷"],
  },
];

const BOSS_ALIAS_TO_KEY = new Map<string, string>();
const BOSS_KEY_TO_ZH = new Map<string, string>();
for (const boss of BOSS_LOCALES) {
  BOSS_KEY_TO_ZH.set(boss.key, boss.zh);
  for (const alias of [boss.key, boss.zh, ...boss.aliases]) {
    BOSS_ALIAS_TO_KEY.set(normalizedName(alias), boss.key);
  }
}

export function canonicalBossKey(value: string): string {
  const normalized = normalizedName(value);
  return BOSS_ALIAS_TO_KEY.get(normalized) ?? normalized;
}

export function localizeBossName(value: string): string {
  const key = canonicalBossKey(value);
  return BOSS_KEY_TO_ZH.get(key) ?? value;
}

export function isBossNameEquivalent(left: string, right: string): boolean {
  const leftKey = canonicalBossKey(left);
  const rightKey = canonicalBossKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  return (
    Math.min(leftKey.length, rightKey.length) >= 5 &&
    (leftKey.includes(rightKey) || rightKey.includes(leftKey))
  );
}

// WCL's public GraphQL endpoint can return English names even when the report
// URL is on the Simplified Chinese site. IDs are stable across locales, so use
// them as the primary localization key and fall back to name aliases.
const SPELL_NAMES_ZH: Record<string, string> = {
  "0": "近战",
  "1": "近战",
  "20053": "复仇",
  "20599": "狮心",
  "24383": "赞扎的愤怒",
  "24907": "枭兽光环",
  "25898": "强效王者祝福",
  "31803": "神圣复仇",
  "31804": "复仇审判",
  "31884": "复仇之怒",
  "32182": "英勇",
  "35395": "十字军打击",
  "42463": "复仇圣印",
  "47753": "神圣庇护",
  "48066": "真言术：盾",
  "48090": "恶魔契约",
  "48470": "野性赐福",
  "48801": "驱邪术",
  "48806": "愤怒之锤",
  "48819": "奉献",
  "48934": "强效力量祝福",
  "50334": "狂暴",
  "53385": "神圣风暴",
  "53760": "无尽怒气合剂",
  "53908": "加速",
  "54861": "硝化甘油推进器",
  "57371": "进食充分",
  "57623": "寒冬号角",
  "59578": "战争艺术",
  "59620": "狂暴",
  "60229": "伟大",
  "60439": "洛欧塞布的阴影",
  "61840": "正义复仇",
  "63944": "新生希望",
  "67371": "神圣力量",
  "1266180": "缚灵闪电",
  "1270652": "泰坦重铸服务器 - 受到伤害光环",
  "1272540": "火球术",
  "1298723": "圣光裁决",
  "1298724": "祈求圣光",
  "1298725": "虔诚",
  "1298730": "祈求圣光",
  "1298872": "圣光推进",
  "1299075": "圣光之怒",
  "1299090": "正义",
};

const SPELL_NAME_ALIASES_ZH: Record<string, string> = {
  melee: "近战",
  attack: "近战",
  autoattack: "近战",
  avengingwrath: "复仇之怒",
  berserk: "狂暴",
  berserking: "狂暴",
  blessingofkings: "王者祝福",
  consecration: "奉献",
  crusaderstrike: "十字军打击",
  demonicpact: "恶魔契约",
  divinestorm: "神圣风暴",
  exorcism: "驱邪术",
  flaskofendlessrage: "无尽怒气合剂",
  greatness: "伟大",
  hammerofwrath: "愤怒之锤",
  heroism: "英勇",
  holystrength: "神圣力量",
  holyvengeance: "神圣复仇",
  hornofwinter: "寒冬号角",
  judgementofvengeance: "复仇审判",
  lionheart: "狮心",
  loathebsshadow: "洛欧塞布的阴影",
  markofthewild: "野性印记",
  powerwordshield: "真言术：盾",
  righteousvengeance: "正义复仇",
  sealofvengeance: "复仇圣印",
  speed: "加速",
  theartofwar: "战争艺术",
  wellfed: "进食充分",
};

function localizedAlias(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return SPELL_NAME_ALIASES_ZH[normalizedName(value)];
}

export function localizeSpellName(
  id: string | number,
  currentName?: string,
  localSpellNames?: Record<string, string>,
): string {
  const key = String(id);
  const stableName = SPELL_NAMES_ZH[key];
  if (stableName) return stableName;

  const localName = localSpellNames?.[key]?.trim();
  const localAlias = localizedAlias(localName);
  if (localAlias) return localAlias;
  if (localName && /[\u3400-\u9fff]/.test(localName)) return localName;

  const current = currentName?.trim();
  const currentAlias = localizedAlias(current);
  if (currentAlias) return currentAlias;
  if (current) return current;
  if (localName) return localName;
  return key === "0" || key === "1" ? "近战" : `技能 ${key}`;
}
