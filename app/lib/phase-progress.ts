const DAY_MS = 24 * 60 * 60 * 1000;

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface PhaseSchedule {
  startedAt: string;
  forecastStartAt: string;
  forecastEndAt: string;
  timelineWeeks: number;
}

export type ForecastStatus = "before" | "in-window" | "overdue";

export interface PhaseProgress {
  currentWeek: number;
  timelineWeeks: number;
  estimatedRemaining: string;
  forecastStatus: ForecastStatus;
}

function dateKeyToDay(dateKey: string): number {
  const normalized = dateKey.replaceAll(".", "-");
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`无效阶段日期：${dateKey}`);
  }
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function getShanghaiDateKey(now: Date): string {
  const parts = Object.fromEntries(
    shanghaiDateFormatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getPhaseWeek(startedAt: string, now: Date): number {
  const elapsedDays =
    dateKeyToDay(getShanghaiDateKey(now)) - dateKeyToDay(startedAt);
  return Math.max(1, Math.floor(elapsedDays / 7) + 1);
}

export function getPhaseProgress(
  schedule: PhaseSchedule,
  now: Date,
): PhaseProgress {
  const today = dateKeyToDay(getShanghaiDateKey(now));
  const daysUntilWindow = dateKeyToDay(schedule.forecastStartAt) - today;
  const daysUntilWindowEnd = dateKeyToDay(schedule.forecastEndAt) - today;
  const currentWeek = getPhaseWeek(schedule.startedAt, now);

  if (daysUntilWindow > 0) {
    const earliestWeeks = Math.max(1, Math.round(daysUntilWindow / 7));
    const latestWeeks = Math.max(
      earliestWeeks,
      Math.round(daysUntilWindowEnd / 7),
    );
    return {
      currentWeek,
      timelineWeeks: Math.max(schedule.timelineWeeks, currentWeek),
      estimatedRemaining:
        earliestWeeks === latestWeeks
          ? `约 ${earliestWeeks} 周`
          : `约 ${earliestWeeks}—${latestWeeks} 周`,
      forecastStatus: "before",
    };
  }

  return {
    currentWeek,
    timelineWeeks: Math.max(schedule.timelineWeeks, currentWeek),
    estimatedRemaining:
      daysUntilWindowEnd >= 0 ? "已进入预估窗口" : "等待官方公告",
    forecastStatus: daysUntilWindowEnd >= 0 ? "in-window" : "overdue",
  };
}
