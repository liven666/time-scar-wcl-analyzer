import {
  parseCombatLogFile,
  type CombatReport,
  type ParseOptions,
} from "./combat-log";

export type CombatLogWorkerResponse =
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

export function createCombatLogWorker(): Worker {
  return new Worker(new URL("./combat-log.worker.ts", import.meta.url), {
    type: "module",
    name: "time-scar-combat-log-parser",
  });
}

export async function parseCombatLogFileInWorker(
  file: File,
  options: ParseOptions,
  onProgress?: (progress: number, message: string) => void,
): Promise<CombatReport> {
  if (typeof Worker === "undefined") {
    return parseCombatLogFile(file, options, onProgress);
  }

  const worker = createCombatLogWorker();
  const requestId = Date.now() + Math.floor(Math.random() * 10_000);
  return new Promise<CombatReport>((resolve, reject) => {
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<CombatLogWorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "progress") {
        onProgress?.(message.progress, message.message);
        return;
      }
      if (message.type === "result") {
        cleanup();
        onProgress?.(100, "解析完成");
        resolve(message.report);
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "后台日志解析线程异常"));
    };
    worker.postMessage({ type: "parse", requestId, file, options });
  });
}
