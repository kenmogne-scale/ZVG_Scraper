import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import { handleRequest } from "./src/app.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const publicDir = path.join(process.cwd(), "public");

const server = createServer((req, res) =>
  handleRequest(req, res, {
    publicDir,
    baseUrl: `http://${host}:${port}`
  }).catch((error) => {
    console.error("Request failed:", error);
    res.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(JSON.stringify({ error: error.message }));
  })
);

server.listen(port, host, () => {
  console.log(`Viewer running at http://${host}:${port}`);
});
