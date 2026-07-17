import type { CombatTimelineEvent } from "./combat-log";

export type OperationStatus = "success" | "failed" | "started" | "direct";

export interface OperationAction {
  key: string;
  event: CombatTimelineEvent;
  status: OperationStatus;
  startedAt: number;
  completedAt: number;
  castDurationMs: number;
  count: number;
  effectCount: number;
  effectAmount: number;
  effectEvents: CombatTimelineEvent[];
  reasons: string[];
}

function eventAmount(event: CombatTimelineEvent): number {
  return event.amount ?? 0;
}

export function buildOperationActions(
  events: CombatTimelineEvent[],
  playerId: string,
): OperationAction[] {
  const playerEvents = events
    .filter(
      (event) =>
        event.sourceActorId === playerId &&
        event.sourceUnitId === playerId,
    )
    .sort((a, b) => a.t - b.t);
  const castEvents = playerEvents.filter(
    (event) =>
      event.kind === "cast-start" ||
      event.kind === "cast" ||
      event.kind === "cast-failed",
  );
  const pendingStarts = new Map<number, CombatTimelineEvent[]>();
  const actions: OperationAction[] = [];
  let serial = 0;

  const takePendingStart = (
    spellId: number,
    completedAt: number,
  ): CombatTimelineEvent | undefined => {
    const pending = pendingStarts.get(spellId);
    if (!pending?.length) return undefined;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const candidate = pending[index];
      if (
        candidate.t <= completedAt &&
        completedAt - candidate.t <= 20_000
      ) {
        pending.splice(index, 1);
        return candidate;
      }
    }
    return undefined;
  };

  for (const event of castEvents) {
    if (event.kind === "cast-start") {
      const pending = pendingStarts.get(event.spellId) ?? [];
      pending.push(event);
      pendingStarts.set(event.spellId, pending);
      continue;
    }
    const start = takePendingStart(event.spellId, event.t);
    actions.push({
      key: `operation-${event.t}-${event.spellId}-${serial++}`,
      event,
      status: event.kind === "cast-failed" ? "failed" : "success",
      startedAt: start?.t ?? event.t,
      completedAt: event.t,
      castDurationMs: start ? Math.max(0, event.t - start.t) : 0,
      count: 1,
      effectCount: 0,
      effectAmount: 0,
      effectEvents: [],
      reasons: event.missType ? [event.missType] : [],
    });
  }

  for (const pending of pendingStarts.values()) {
    for (const event of pending) {
      actions.push({
        key: `operation-${event.t}-${event.spellId}-${serial++}`,
        event,
        status: "started",
        startedAt: event.t,
        completedAt: event.t,
        castDurationMs: 0,
        count: 1,
        effectCount: 0,
        effectAmount: 0,
        effectEvents: [],
        reasons: [],
      });
    }
  }

  const effectEvents = playerEvents.filter(
    (event) =>
      event.spellId > 0 &&
      (event.kind === "damage" ||
        event.kind === "heal" ||
        event.kind === "absorb" ||
        event.kind === "miss" ||
        event.kind === "interrupt" ||
        event.kind === "dispel" ||
        event.kind === "resource"),
  );
  for (const effect of effectEvents) {
    const associationWindowMs = effect.periodic
      ? 60_000
      : effect.kind === "absorb"
        ? 30_000
        : 6_000;
    const matchingAction = actions
      .filter(
        (action) =>
          action.status === "success" &&
          action.event.spellId === effect.spellId &&
          effect.t >= action.startedAt - 250 &&
          effect.t <= action.completedAt + associationWindowMs,
      )
      .sort(
        (a, b) =>
          Math.abs(a.completedAt - effect.t) -
          Math.abs(b.completedAt - effect.t),
      )[0];
    if (matchingAction) {
      matchingAction.effectEvents.push(effect);
      matchingAction.effectCount += 1;
      matchingAction.effectAmount += eventAmount(effect);
      continue;
    }
    // Periodic ticks without a matching cast belong in the detailed skill
    // timeline, but should not create one fake player action per tick.
    if (effect.periodic) continue;
    actions.push({
      key: `operation-${effect.t}-${effect.spellId}-${serial++}`,
      event: effect,
      status: effect.kind === "miss" ? "failed" : "direct",
      startedAt: effect.t,
      completedAt: effect.t,
      castDurationMs: 0,
      count: 1,
      effectCount: 1,
      effectAmount: eventAmount(effect),
      effectEvents: [effect],
      reasons: effect.missType ? [effect.missType] : [],
    });
  }

  return actions.sort(
    (a, b) =>
      a.startedAt - b.startedAt ||
      a.completedAt - b.completedAt ||
      a.event.spellId - b.event.spellId,
  );
}
