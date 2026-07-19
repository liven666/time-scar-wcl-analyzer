import {
  buildWclComparisonProfile,
  type ComparisonProfile,
  type WclProfileMetadata,
} from "../../../lib/player-comparison";
import {
  isBossNameEquivalent,
  localizeBossName,
} from "../../../lib/wow-localization";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

interface CompareRequestBody {
  url?: unknown;
  actorName?: unknown;
  bossName?: unknown;
  encounterId?: unknown;
}

interface ParsedWclUrl {
  original: string;
  kind: "report" | "character";
  reportCode?: string;
  characterId?: number;
  fightId?: number;
  sourceId?: number;
}

interface WclFight {
  id: number;
  encounterID: number;
  name: string;
  startTime: number;
  endTime: number;
  kill: boolean;
  friendlyPlayers?: number[];
  friendlySpecs?: string[];
}

interface WclActor {
  id: number;
  name: string;
  type?: string;
  subType?: string;
  petOwner?: number;
}

interface WclAbility {
  gameID: number;
  name: string;
}

interface WclReportMetadata {
  code: string;
  title: string;
  startTime: number;
  fights: WclFight[];
  masterData: {
    actors: WclActor[];
    abilities: WclAbility[];
  };
}

class RouteError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly code = "WCL_COMPARE_ERROR",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let cachedToken:
  | { clientId: string; value: string; expiresAt: number }
  | undefined;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·'’\-_:：()（）]/g, "")
    .replace(/高阶祭司|highpriest/g, "");
}

function parseWclUrl(rawValue: unknown): ParsedWclUrl {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    throw new RouteError("请粘贴 WCL 报告链接或角色链接");
  }
  const cleaned = rawValue.trim().replace(/^[<{\[]+|[>}\]]+$/g, "");
  if (cleaned.length > 1_500) throw new RouteError("WCL 链接过长");
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new RouteError("WCL 链接格式不正确");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "warcraftlogs.com" &&
    !hostname.endsWith(".warcraftlogs.com")
  ) {
    throw new RouteError("只支持 warcraftlogs.com 官方链接");
  }

  const reportMatch = url.pathname.match(/\/reports\/([a-z0-9]+)/i);
  if (reportMatch) {
    const fight = numberValue(url.searchParams.get("fight"));
    const source = numberValue(url.searchParams.get("source"));
    return {
      original: url.toString(),
      kind: "report",
      reportCode: reportMatch[1],
      fightId: fight && fight > 0 ? Math.floor(fight) : undefined,
      sourceId: source && source > 0 ? Math.floor(source) : undefined,
    };
  }

  const characterMatch = url.pathname.match(/\/character\/id\/(\d+)/i);
  if (characterMatch) {
    return {
      original: url.toString(),
      kind: "character",
      characterId: Number(characterMatch[1]),
    };
  }
  throw new RouteError("链接中没有识别到报告代码或角色 ID");
}

function environment(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() || undefined;
}

async function accessToken(): Promise<string> {
  const clientId = environment("WCL_CLIENT_ID");
  const clientSecret = environment("WCL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new RouteError(
      "WCL 对比服务尚未配置。部署者需要设置 WCL_CLIENT_ID 和 WCL_CLIENT_SECRET。",
      503,
      "WCL_NOT_CONFIGURED",
    );
  }
  if (
    cachedToken?.clientId === clientId &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.value;
  }
  const tokenUrl =
    environment("WCL_OAUTH_URL") ?? "https://www.warcraftlogs.com/oauth/token";
  const encoded = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${encoded}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) {
    throw new RouteError(
      `WCL OAuth 授权失败（${response.status}）`,
      502,
      "WCL_OAUTH_FAILED",
    );
  }
  const payload = asRecord(await response.json());
  const token = stringValue(payload?.access_token);
  if (!token) {
    throw new RouteError("WCL OAuth 响应中没有访问令牌", 502, "WCL_OAUTH_FAILED");
  }
  cachedToken = {
    clientId,
    value: token,
    expiresAt: Date.now() + (numberValue(payload?.expires_in) ?? 3_600) * 1_000,
  };
  return token;
}

async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await accessToken();
  const endpoint =
    environment("WCL_API_URL") ??
    "https://www.warcraftlogs.com/api/v2/client";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.5",
      "user-agent": "TimeScar-WCL-Compare/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new RouteError(
      `WCL API 请求失败（${response.status}）`,
      response.status === 429 ? 429 : 502,
      response.status === 429 ? "WCL_RATE_LIMITED" : "WCL_API_FAILED",
    );
  }
  const payload = asRecord(await response.json());
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (errors.length) {
    const message = errors
      .map((error) => stringValue(asRecord(error)?.message))
      .filter(Boolean)
      .join("；");
    throw new RouteError(
      message || "WCL API 返回错误",
      502,
      "WCL_GRAPHQL_ERROR",
    );
  }
  if (!payload?.data) {
    throw new RouteError("WCL API 没有返回数据", 502, "WCL_API_FAILED");
  }
  return payload.data as T;
}

const REPORT_METADATA_QUERY = `
  query ReportMetadata($code: String!) {
    reportData {
      report(code: $code) {
        code
        title
        startTime
        fights(translate: true) {
          id
          encounterID
          name
          startTime
          endTime
          kill
          friendlyPlayers
          friendlySpecs
        }
        masterData(translate: true) {
          actors { id name type subType petOwner }
          abilities { gameID name }
        }
      }
    }
  }
`;

async function loadReportMetadata(code: string): Promise<WclReportMetadata> {
  const data = await graphql<{
    reportData?: { report?: WclReportMetadata | null };
  }>(REPORT_METADATA_QUERY, { code });
  const report = data.reportData?.report;
  if (!report) {
    throw new RouteError("没有找到这份 WCL 报告，或报告不是公开状态", 404);
  }
  return report;
}

function findFight(
  report: WclReportMetadata,
  requestedFightId: number | undefined,
  encounterId: number | undefined,
  bossName: string | undefined,
): WclFight | undefined {
  if (requestedFightId) {
    return report.fights.find((fight) => fight.id === requestedFightId);
  }
  const normalizedBoss = bossName ? normalized(bossName) : "";
  return [...report.fights]
    .reverse()
    .find(
      (fight) =>
        (encounterId !== undefined && fight.encounterID === encounterId) ||
        (normalizedBoss &&
          (normalized(fight.name) === normalizedBoss ||
            isBossNameEquivalent(fight.name, bossName!))),
    );
}

function playerActor(
  report: WclReportMetadata,
  sourceId: number | undefined,
  actorName: string | undefined,
): WclActor | undefined {
  const players = report.masterData.actors.filter(
    (actor) => actor.type?.toLowerCase() === "player",
  );
  if (sourceId) return players.find((actor) => actor.id === sourceId);
  const wanted = actorName ? normalized(actorName.split("-")[0]) : "";
  if (wanted) {
    return players.find(
      (actor) => normalized(actor.name.split("-")[0]) === wanted,
    );
  }
  return undefined;
}

function roleFromSpec(spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const value = normalized(spec);
  if (
    /restoration|holy|discipline|healer|恢复|神圣|戒律|治疗/.test(value)
  ) {
    return "healer";
  }
  if (
    /protection|blood|guardian|brewmaster|vengeance|防护|鲜血|守护|坦克/.test(
      value,
    )
  ) {
    return "tank";
  }
  return "dps";
}

function fightSpec(fight: WclFight, actorId: number): string | undefined {
  const index = fight.friendlyPlayers?.indexOf(actorId) ?? -1;
  return index >= 0 ? fight.friendlySpecs?.[index] : undefined;
}

async function resolveCharacterReport(
  characterId: number,
  encounterId: number | undefined,
  bossName: string | undefined,
): Promise<{ report: WclReportMetadata; fight: WclFight; actorName: string }> {
  const data = await graphql<{
    characterData?: {
      character?: {
        name: string;
        recentReports?: { data?: Array<{ code: string }> };
      } | null;
    };
  }>(
    `query CharacterReports($id: Int!) {
      characterData {
        character(id: $id) {
          name
          recentReports(limit: 12) { data { code } }
        }
      }
    }`,
    { id: characterId },
  );
  const character = data.characterData?.character;
  if (!character) throw new RouteError("没有找到这个 WCL 角色", 404);
  const codes = (character.recentReports?.data ?? [])
    .map((report) => report.code)
    .filter((code) => /^[a-z0-9]+$/i.test(code))
    .slice(0, 12);
  if (!codes.length) throw new RouteError("该角色没有可读取的近期公开报告", 404);

  const variables: Record<string, unknown> = {};
  const definitions: string[] = [];
  const fields: string[] = [];
  codes.forEach((code, index) => {
    variables[`code${index}`] = code;
    definitions.push(`$code${index}: String!`);
    fields.push(
      `r${index}: report(code: $code${index}) { code fights(translate: true) { id encounterID name startTime endTime kill } }`,
    );
  });
  const recentData = await graphql<{
    reportData?: Record<
      string,
      { code: string; fights: WclFight[] } | null | undefined
    >;
  }>(
    `query RecentFights(${definitions.join(", ")}) {
      reportData { ${fields.join("\n")} }
    }`,
    variables,
  );
  for (let index = 0; index < codes.length; index += 1) {
    const candidate = recentData.reportData?.[`r${index}`];
    if (!candidate) continue;
    const fight = findFight(
      {
        ...candidate,
        title: "",
        startTime: 0,
        masterData: { actors: [], abilities: [] },
      },
      undefined,
      encounterId,
      bossName,
    );
    if (!fight) continue;
    const report = await loadReportMetadata(candidate.code);
    const completeFight = report.fights.find((item) => item.id === fight.id);
    if (completeFight) {
      return { report, fight: completeFight, actorName: character.name };
    }
  }
  throw new RouteError(
    `在该角色最近 ${codes.length} 份公开报告里没有找到 ${bossName ?? "所选 Boss"}`,
    404,
    "WCL_MATCH_NOT_FOUND",
  );
}

async function loadEvents(
  reportCode: string,
  fight: WclFight,
  sourceId: number,
): Promise<UnknownRecord[]> {
  const query = `
    query ReportEvents(
      $code: String!
      $fightIDs: [Int]!
      $sourceID: Int!
      $startTime: Float!
      $endTime: Float!
    ) {
      reportData {
        report(code: $code) {
          events(
            dataType: All
            fightIDs: $fightIDs
            sourceID: $sourceID
            startTime: $startTime
            endTime: $endTime
            includeResources: true
            limit: 10000
            translate: true
          ) { data nextPageTimestamp }
        }
      }
    }
  `;
  const events: UnknownRecord[] = [];
  let startTime = fight.startTime;
  for (let page = 0; page < 25; page += 1) {
    const data = await graphql<{
      reportData?: {
        report?: {
          events?: { data?: unknown[]; nextPageTimestamp?: number | null };
        } | null;
      };
    }>(query, {
      code: reportCode,
      fightIDs: [fight.id],
      sourceID: sourceId,
      startTime,
      endTime: fight.endTime,
    });
    const pageData = data.reportData?.report?.events;
    for (const event of pageData?.data ?? []) {
      const record = asRecord(event);
      if (record) events.push(record);
    }
    const next = numberValue(pageData?.nextPageTimestamp);
    if (!next || next <= startTime || next >= fight.endTime) break;
    startTime = next;
  }
  return events;
}

interface WclTables {
  damageSource?: unknown;
  healingSource?: unknown;
  damageAbilities?: unknown;
  healingAbilities?: unknown;
}

async function loadTables(
  reportCode: string,
  fightId: number,
  sourceId: number,
): Promise<WclTables> {
  const data = await graphql<{
    reportData?: { report?: WclTables | null };
  }>(
    `query ReportTables($code: String!, $fightIDs: [Int]!, $sourceID: Int!) {
      reportData {
        report(code: $code) {
          damageSource: table(dataType: DamageDone, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Source, translate: true)
          healingSource: table(dataType: Healing, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Source, translate: true)
          damageAbilities: table(dataType: DamageDone, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Ability, translate: true)
          healingAbilities: table(dataType: Healing, fightIDs: $fightIDs, sourceID: $sourceID, viewBy: Ability, translate: true)
        }
      }
    }`,
    { code: reportCode, fightIDs: [fightId], sourceID: sourceId },
  );
  return data.reportData?.report ?? {};
}

function tableEntries(payload: unknown): UnknownRecord[] {
  const root = asRecord(payload);
  if (!root) return [];
  const direct = root.entries;
  if (Array.isArray(direct)) return direct.map(asRecord).filter(Boolean) as UnknownRecord[];
  for (const value of Object.values(root)) {
    const nested = tableEntries(value);
    if (nested.length) return nested;
  }
  return [];
}

function sourceTableSummary(
  payload: unknown,
  playerId: number,
  playerName: string,
): { total?: number; activeTime?: number } {
  const entries = tableEntries(payload);
  const entry =
    entries.find(
      (item) =>
        numberValue(item.id) === playerId || numberValue(item.guid) === playerId,
    ) ??
    entries.find(
      (item) =>
        stringValue(item.name) &&
        normalized(stringValue(item.name)!) === normalized(playerName),
    ) ??
    (entries.length === 1 ? entries[0] : undefined);
  return {
    total: numberValue(entry?.total ?? entry?.amount),
    activeTime: numberValue(entry?.activeTime ?? entry?.activeTimeReduced),
  };
}

function applyAbilityTable(
  profile: ComparisonProfile,
  payload: unknown,
  metric: "damage" | "healing",
): void {
  for (const entry of tableEntries(payload)) {
    const name = stringValue(entry.name);
    const idValue = numberValue(entry.guid ?? entry.gameID ?? entry.id);
    const ability =
      (idValue !== undefined
        ? profile.abilities.find((item) => item.id === String(idValue))
        : undefined) ??
      (name
        ? profile.abilities.find(
            (item) => normalized(item.name) === normalized(name),
          )
        : undefined);
    if (!ability) continue;
    const total = numberValue(entry.total ?? entry.amount);
    if (total !== undefined) ability[metric] = total;
    const uses = numberValue(entry.uses ?? entry.casts);
    if (uses !== undefined && uses >= 0) ability.casts = uses;
  }
}

async function profileFromReport(
  report: WclReportMetadata,
  fight: WclFight,
  actor: WclActor,
  originalUrl: string,
): Promise<ComparisonProfile> {
  const [events, tables] = await Promise.all([
    loadEvents(report.code, fight, actor.id),
    loadTables(report.code, fight.id, actor.id),
  ]);
  const specialization = fightSpec(fight, actor.id);
  const metadata: WclProfileMetadata = {
    reportCode: report.code,
    reportUrl: originalUrl,
    fightId: fight.id,
    encounterId: fight.encounterID,
    bossName: localizeBossName(fight.name),
    fightStartMs: fight.startTime,
    fightEndMs: fight.endTime,
    playerId: actor.id,
    playerName: actor.name,
    className: actor.subType,
    specialization,
    role: roleFromSpec(specialization),
    kill: fight.kill,
  };
  const abilityNames = Object.fromEntries(
    report.masterData.abilities.map((ability) => [String(ability.gameID), ability.name]),
  );
  const profile = buildWclComparisonProfile(metadata, events, abilityNames);
  applyAbilityTable(profile, tables.damageAbilities, "damage");
  applyAbilityTable(profile, tables.healingAbilities, "healing");
  const damageSummary = sourceTableSummary(
    tables.damageSource,
    actor.id,
    actor.name,
  );
  const healingSummary = sourceTableSummary(
    tables.healingSource,
    actor.id,
    actor.name,
  );
  if (damageSummary.total !== undefined) profile.totalDamage = damageSummary.total;
  if (healingSummary.total !== undefined) profile.totalHealing = healingSummary.total;
  const activeTime = damageSummary.activeTime ?? healingSummary.activeTime;
  if (activeTime !== undefined) {
    profile.activeMs = Math.min(profile.durationMs, Math.max(0, activeTime));
  }
  return profile;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const contentLength = numberValue(request.headers.get("content-length"));
    if (contentLength && contentLength > 20_000) {
      throw new RouteError("请求内容过大", 413);
    }
    const body = (await request.json()) as CompareRequestBody;
    const parsed = parseWclUrl(body.url);
    const actorName = stringValue(body.actorName);
    const bossName = stringValue(body.bossName);
    const encounterId = numberValue(body.encounterId);

    let report: WclReportMetadata;
    let fight: WclFight | undefined;
    let fallbackActorName = actorName;
    if (parsed.kind === "report") {
      report = await loadReportMetadata(parsed.reportCode!);
      fight = findFight(
        report,
        parsed.fightId,
        encounterId,
        bossName,
      );
    } else {
      const resolved = await resolveCharacterReport(
        parsed.characterId!,
        encounterId,
        bossName,
      );
      report = resolved.report;
      fight = resolved.fight;
      fallbackActorName ??= resolved.actorName;
    }
    if (!fight) {
      throw new RouteError(
        `报告里没有找到 ${bossName ?? "所选 Boss"}；请使用带 fight 参数的战斗链接`,
        404,
        "WCL_MATCH_NOT_FOUND",
        report.fights
          .filter((item) => item.encounterID > 0)
          .slice(-12)
          .map((item) => ({ id: item.id, name: item.name, kill: item.kill })),
      );
    }
    const actor = playerActor(
      report,
      parsed.sourceId,
      fallbackActorName,
    );
    if (!actor) {
      throw new RouteError(
        "没有定位到对比角色。请使用带 source 参数的 WCL 链接，或填写角色名。",
        422,
        "WCL_ACTOR_NOT_FOUND",
        report.masterData.actors
          .filter((item) => item.type?.toLowerCase() === "player")
          .map((item) => ({ id: item.id, name: item.name, className: item.subType })),
      );
    }
    if (!fight.friendlyPlayers?.includes(actor.id)) {
      throw new RouteError(`${actor.name} 没有参加所选 Boss 战`, 422);
    }

    const profile = await profileFromReport(
      report,
      fight,
      actor,
      parsed.original,
    );
    return json({
      profile,
      resolved: {
        reportCode: report.code,
        reportTitle: report.title,
        fightId: fight.id,
        bossName: localizeBossName(fight.name),
        playerId: actor.id,
        playerName: actor.name,
        eventCount: profile.abilities.reduce(
          (sum, ability) => sum + ability.landed + ability.misses,
          0,
        ),
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        error.status,
      );
    }
    return json(
      {
        error: error instanceof Error ? error.message : "WCL 对比请求失败",
        code: "WCL_COMPARE_ERROR",
      },
      500,
    );
  }
}
