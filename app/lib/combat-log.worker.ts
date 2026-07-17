/// <reference lib="webworker" />

import {
  CombatLogStreamParser,
  type CombatReport,
  type ParseOptions,
} from "./combat-log";

type ParseRequest = {
  type: "parse";
  requestId: number;
  file: File;
  options: ParseOptions;
};

type LiveStartRequest = {
  type: "live-start";
  requestId: number;
  file: File;
  options: ParseOptions;
};

type LiveAppendRequest = {
  type: "live-append";
  requestId: number;
  sourceSize: number;
  chunk: ArrayBuffer;
};

type WorkerRequest = ParseRequest | LiveStartRequest | LiveAppendRequest;

type WorkerResponse =
  | {
      type: "progress";
      requestId: number;
      progress: number;
      message: string;
    }
  | {
      type: "result" | "live-ready";
      requestId: number;
      report: CombatReport;
      sourceSize: number;
    }
  | {
      type: "live-update";
      requestId: number;
      report: CombatReport;
      fightCount: number;
      sourceSize: number;
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let liveParser: CombatLogStreamParser | null = null;
let liveRequestId = 0;

function send(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function appendFile(
  file: File,
  parser: CombatLogStreamParser,
  requestId: number,
): Promise<void> {
  const reader = file.stream().getReader();
  let bytesRead = 0;
  let lastProgress = -1;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.append(value);
    bytesRead += value.byteLength;
    const progress = Math.min(
      96,
      Math.round((bytesRead / Math.max(1, file.size)) * 96),
    );
    if (progress !== lastProgress && (progress % 2 === 0 || progress >= 94)) {
      lastProgress = progress;
      send({
        type: "progress",
        requestId,
        progress,
        message: `后台解析 ${parser.totalLines.toLocaleString("zh-CN")} 行`,
      });
    }
  }
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === "parse") {
      const parser = new CombatLogStreamParser(
        message.file.name,
        message.file.size,
        message.options,
      );
      await appendFile(message.file, parser, message.requestId);
      send({
        type: "progress",
        requestId: message.requestId,
        progress: 98,
        message: "正在生成伤害口径与团队结论",
      });
      send({
        type: "result",
        requestId: message.requestId,
        report: parser.finish(message.file.size),
        sourceSize: message.file.size,
      });
      return;
    }

    if (message.type === "live-start") {
      liveRequestId = message.requestId;
      liveParser = new CombatLogStreamParser(
        message.file.name,
        message.file.size,
        message.options,
      );
      await appendFile(message.file, liveParser, message.requestId);
      send({
        type: "live-ready",
        requestId: message.requestId,
        report: liveParser.snapshot(message.file.size),
        sourceSize: message.file.size,
      });
      return;
    }

    if (
      message.type === "live-append" &&
      liveParser &&
      message.requestId === liveRequestId
    ) {
      liveParser.append(new Uint8Array(message.chunk));
      const report = liveParser.snapshot(message.sourceSize, {
        latestFightOnly: true,
      });
      send({
        type: "live-update",
        requestId: message.requestId,
        report,
        fightCount: liveParser.fightCount,
        sourceSize: message.sourceSize,
      });
    }
  } catch (reason) {
    send({
      type: "error",
      requestId: message.requestId,
      message: reason instanceof Error ? reason.message : "日志解析失败",
    });
  }
};

export {};
