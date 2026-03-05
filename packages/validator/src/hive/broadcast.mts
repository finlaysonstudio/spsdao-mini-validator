import { Client, PrivateKey } from "@hiveio/dhive";
import { config } from "../config.mjs";

const client = new Client(config.rpcNodes);

export interface BroadcastResult {
  success: boolean;
  error?: string;
}

export async function broadcastCustomJson({
  account,
  postingKey,
  id,
  json,
  action,
  blockNum,
}: {
  account: string;
  postingKey: string;
  id: string;
  json: string;
  action: string;
  blockNum: number;
}): Promise<BroadcastResult> {
  try {
    const key = PrivateKey.fromString(postingKey);
    await client.broadcast.sendOperations(
      [
        [
          "custom_json",
          {
            required_auths: [],
            required_posting_auths: [account],
            id,
            json,
          },
        ],
      ],
      key,
    );
    console.log(
      `[broadcast] ${action} by ${account} at block ${blockNum} — success`,
    );
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `[broadcast] ${action} by ${account} at block ${blockNum} — failed: ${message}`,
    );
    return { success: false, error: message };
  }
}
