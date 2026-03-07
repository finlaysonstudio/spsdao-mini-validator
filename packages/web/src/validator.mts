import { config } from "@spsdao/validator/config";
import { StateStore } from "@spsdao/validator/state";
import { bootstrap } from "@spsdao/validator/bootstrap";
import { getBlock } from "@spsdao/validator/hive/client";
import { processBlock } from "@spsdao/validator/pipeline";
import type { BlockDetail } from "@spsdao/validator/pipeline";
import { BlockStore } from "./blockStore.mjs";

export class StepValidator {
  private state: StateStore | null = null;
  private prevL2Hash = "";
  private nextBlockNum = 0;
  private processing = false;
  readonly blockStore: BlockStore;

  constructor(blockStore: BlockStore) {
    this.blockStore = blockStore;
  }

  async bootstrap(): Promise<BlockDetail> {
    console.log("SPS Mini Validator starting...");

    this.state = new StateStore();
    const { startBlock, prevL2Hash } = await bootstrap(
      this.state,
      config.seedFile,
    );

    this.prevL2Hash = prevL2Hash;
    this.nextBlockNum = startBlock;

    console.log(`Ready at block ${startBlock}`);
    console.log(`RPC nodes: ${config.rpcNodes.join(", ")}`);

    // Process the first block automatically
    return this.processNext();
  }

  async processNext(): Promise<BlockDetail> {
    if (!this.state) throw new Error("Not bootstrapped");
    if (this.processing) throw new Error("Already processing");

    this.processing = true;
    try {
      const blockNum = this.nextBlockNum;
      let block = await getBlock(blockNum);

      // Retry if block not available yet
      while (!block) {
        await new Promise((r) => setTimeout(r, 3000));
        block = await getBlock(blockNum);
      }

      const detail = processBlock(block, blockNum, this.state, this.prevL2Hash);
      this.blockStore.add(detail);
      this.prevL2Hash = detail.l2Hash;
      this.nextBlockNum = blockNum + 1;

      console.log(
        `Block ${blockNum} | ${detail.allTransactions.length} txns | hash: ${detail.l2Hash.slice(0, 12)}...`,
      );

      return detail;
    } finally {
      this.processing = false;
    }
  }

  getNextBlockNum(): number {
    return this.nextBlockNum;
  }

  isReady(): boolean {
    return this.state !== null;
  }
}
