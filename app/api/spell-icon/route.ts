import { LOCAL_WOTLK_SPELL_ICONS } from "../../lib/local-spell-icons";
import { TIME_SERVER_SPELL_ICON_ALIASES } from "../../lib/time-server-spell-icons";

const WOWHEAD_TOOLTIP_ROOT =
  "https://nether.wowhead.com/wotlk/tooltip/spell";
const WOWHEAD_ICON_ROOT =
  "https://wow.zamimg.com/images/wow/icons/large";
const WARCRAFT_WIKI_ICON_ROOT =
  "https://warcraft.wiki.gg/wiki/Special:Redirect/file";
const DEFAULT_MELEE_ICON = "ability_meleedamage";
const ICON_NAME_PATTERN = /^[a-z0-9_-]+$/i;

const iconNameCache = new Map<number, string | null>();
const pendingIconNames = new Map<number, Promise<string | null>>();

function parseSpellId(request: Request): number | null {
  const value = new URL(request.url).searchParams.get("spellId");
  if (!value || !/^-?\d+$/.test(value)) return null;
  const spellId = Number(value);
  if (!Number.isSafeInteger(spellId) || Math.abs(spellId) > 10_000_000) {
    return null;
  }
  return spellId;
}

async function resolveIconName(spellId: number): Promise<string | null> {
  if (spellId <= 0) return DEFAULT_MELEE_ICON;
  const localIconName =
    LOCAL_WOTLK_SPELL_ICONS[spellId] ??
    TIME_SERVER_SPELL_ICON_ALIASES[spellId];
  if (localIconName) return localIconName;
  if (iconNameCache.has(spellId)) {
    return iconNameCache.get(spellId) ?? null;
  }

  const pending = pendingIconNames.get(spellId);
  if (pending) return pending;

  const request = fetch(`${WOWHEAD_TOOLTIP_ROOT}/${spellId}`, {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.wowhead.com/",
      "user-agent":
        "Mozilla/5.0 (compatible; TimeScar-SpellIcon/1.0; +http://localhost)",
    },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as { icon?: unknown };
      return typeof payload.icon === "string" &&
        ICON_NAME_PATTERN.test(payload.icon)
        ? payload.icon.toLowerCase()
        : null;
    })
    .catch(() => null)
    .then((iconName) => {
      iconNameCache.set(spellId, iconName);
      return iconName;
    })
    .finally(() => pendingIconNames.delete(spellId));

  pendingIconNames.set(spellId, request);
  return request;
}

function missingIconResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const spellId = parseSpellId(request);
  if (spellId === null) return missingIconResponse();

  const iconName = await resolveIconName(spellId);
  if (!iconName) return missingIconResponse();

  const iconSources = [
    `${WARCRAFT_WIKI_ICON_ROOT}/${iconName}.png`,
    `${WOWHEAD_ICON_ROOT}/${iconName}.jpg`,
  ];

  for (const iconSource of iconSources) {
    try {
      const iconResponse = await fetch(iconSource, {
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
          "user-agent":
            "Mozilla/5.0 (compatible; TimeScar-SpellIcon/1.0; +http://localhost)",
        },
        redirect: "follow",
      });
      if (!iconResponse.ok || !iconResponse.body) continue;

      const contentType = iconResponse.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) continue;

      const headers = new Headers({
        "cache-control":
          "public, max-age=604800, stale-while-revalidate=2592000",
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      });
      const etag = iconResponse.headers.get("etag");
      if (etag) headers.set("etag", etag);

      return new Response(iconResponse.body, {
        status: 200,
        headers,
      });
    } catch {
      // Continue to the next mirror; the UI keeps a text fallback if all fail.
    }
  }

  return missingIconResponse();
}
