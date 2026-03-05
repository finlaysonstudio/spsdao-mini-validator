import type { IncomingMessage, ServerResponse } from "node:http";
import type { StepValidator } from "./validator.mjs";

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  validator: StepValidator,
): boolean {
  const url = req.url ?? "";
  const blockStore = validator.blockStore;

  if (url === "/api/status") {
    const range = blockStore.getRange();
    const latest = blockStore.getLatest();
    json(res, {
      ready: validator.isReady(),
      blockRange: range,
      latestBlock: latest?.blockNum ?? null,
      latestHash: latest?.l2Hash ?? null,
      nextBlockNum: validator.getNextBlockNum(),
    });
    return true;
  }

  if (url === "/api/blocks/next" && req.method === "POST") {
    if (!validator.isReady()) {
      json(res, { error: "Validator not ready yet" }, 503);
      return true;
    }
    validator
      .processNext()
      .then((detail) => json(res, detail))
      .catch((err) => json(res, { error: String(err.message) }, 500));
    return true;
  }

  const blockMatch = url.match(/^\/api\/blocks\/(\d+)$/);
  if (blockMatch) {
    const blockNum = parseInt(blockMatch[1], 10);
    const detail = blockStore.get(blockNum);
    if (!detail) {
      json(res, { error: `Block ${blockNum} not in store` }, 404);
      return true;
    }
    json(res, detail);
    return true;
  }

  return false;
}
