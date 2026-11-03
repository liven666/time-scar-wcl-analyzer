import assert from "node:assert/strict";
import test from "node:test";

import {
  getPhaseProgress,
  getPhaseWeek,
  getShanghaiDateKey,
} from "../app/lib/phase-progress";

const schedule = {
  startedAt: "2026-10-08",
  forecastStartAt: "2026-12-03",
  forecastEndAt: "2026-12-17",
  timelineWeeks: 11,
};

test("calculates Titan phase weeks from Shanghai calendar dates", () => {
  assert.equal(getShanghaiDateKey(new Date("2026-10-07T16:00:00Z")), "2026-10-08");
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-10-07T16:00:00Z")), 1);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-10-14T15:59:59Z")), 1);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-10-14T16:00:00Z")), 2);
  assert.equal(getPhaseWeek(schedule.startedAt, new Date("2026-11-03T04:00:00Z")), 4);
});

test("updates the remaining forecast without producing negative weeks", () => {
  const before = getPhaseProgress(schedule, new Date("2026-11-03T04:00:00Z"));
  assert.equal(before.currentWeek, 4);
  assert.equal(before.estimatedRemaining, "约 4—6 周");
  assert.equal(before.forecastStatus, "before");

  const inWindow = getPhaseProgress(schedule, new Date("2026-12-03T04:00:00Z"));
  assert.equal(inWindow.estimatedRemaining, "已进入预估窗口");
  assert.equal(inWindow.forecastStatus, "in-window");

  const overdue = getPhaseProgress(schedule, new Date("2026-12-18T04:00:00Z"));
  assert.equal(overdue.estimatedRemaining, "等待官方公告");
  assert.equal(overdue.forecastStatus, "overdue");
  assert.ok(overdue.timelineWeeks >= overdue.currentWeek);
});
