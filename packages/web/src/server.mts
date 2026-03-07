import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StepValidator } from "./validator.mjs";
import { handleApi } from "./routes.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
};

export function startServer(port: number, validator: StepValidator): void {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    // API routes
    if (url.startsWith("/api/")) {
      const handled = handleApi(req, res, validator);
      if (handled) return;
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Static file serving
    let filePath = url === "/" ? "/index.html" : url;

    // Prevent directory traversal
    if (filePath.includes("..")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const fullPath = join(PUBLIC_DIR, filePath);
    const ext = extname(fullPath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      const content = await readFile(fullPath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  server.listen(port, () => {
    console.log(`Web UI available at http://localhost:${port}`);
  });
}
