import assert from "node:assert/strict";
import test from "node:test";

import {
  getPhaseProgress,
  getPhaseWeek,
  getShanghaiDateKey,
} from "../app/lib/phase-progress";

const schedule = {
  startedAt: "2026-08-06",
  forecastStartAt: "2026-10-01",
  forecastEndAt: "2026-10-15",
  timelineWeeks: 10,
};

test("calculates Titan phase weeks from Shanghai calendar dates", () => {
  assert.equal(getShanghaiDateKey(new Date("2026-08-05T16:00:00Z")), "2026-08-06");
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-08-05T16:00:00Z")), 1);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-08-12T15:59:59Z")), 1);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-08-12T16:00:00Z")), 2);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-08-17T04:00:00Z")), 2);
});

test("updates the remaining forecast without producing negative weeks", () => {
  const before = getPhaseProgress(schedule, new Date("2026-08-17T04:00:00Z"));
  assert.equal(before.currentWeek, 2);
  assert.equal(before.estimatedRemaining, "约 6—8 周");
  assert.equal(before.forecastStatus, "before");

  const inWindow = getPhaseProgress(schedule, new Date("2026-10-01T04:00:00Z"));
  assert.equal(inWindow.estimatedRemaining, "已进入预估窗口");
  assert.equal(inWindow.forecastStatus, "in-window");

  const overdue = getPhaseProgress(schedule, new Date("2026-10-16T04:00:00Z"));
  assert.equal(overdue.estimatedRemaining, "等待官方公告");
  assert.equal(overdue.forecastStatus, "overdue");
  assert.ok(overdue.timelineWeeks >= overdue.currentWeek);
});
