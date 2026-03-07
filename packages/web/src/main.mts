import { BlockStore } from "./blockStore.mjs";
import { startServer } from "./server.mjs";
import { StepValidator } from "./validator.mjs";

const port = parseInt(process.env.WEB_PORT ?? "3000", 10);
const retention = parseInt(process.env.BLOCK_RETENTION ?? "1000", 10);

const blockStore = new BlockStore(retention);
const validator = new StepValidator(blockStore);

// Start HTTP server immediately
startServer(port, validator);

// Bootstrap and process first block
validator.bootstrap().catch((err) => {
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});
