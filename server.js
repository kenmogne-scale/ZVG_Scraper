import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchBinary, fetchDetail } from "./src/client.js";
import { STATES } from "./src/constants.js";
import {
  ensureDatabase,
  getAuctionByKey,
  getDatabaseInfo,
  getLatestRun,
  listAuctions,
  listPipelineItems,
  runAutomatedAnalysis,
  updateAuctionAnalysis,
  upsertPipelineItem
} from "./src/db.js";
import { runScrape } from "./src/scrape.js";
const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const lastStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastRunId: null,
  error: null
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function notFound(res, message = "Not found") {
  sendJson(res, 404, { error: message });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPaginationParams(url) {
  return {
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 10),
    scope: url.searchParams.get("scope") === "all" ? "all" : "upcoming"
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

async function getStatusPayload() {
  return {
    scrape: lastStatus,
    latestRun: await getLatestRun(),
    database: getDatabaseInfo()
  };
}

await ensureDatabase();

async function serveStatic(res, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const content = await readFile(filePath);
    send(res, 200, content, contentTypes[ext] ?? "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") {
      send(res, 404, "Not found");
      return;
    }

    send(res, 500, error.message);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;

  if (pathname === "/api/auctions") {
    sendJson(res, 200, await listAuctions(getPaginationParams(url)));
    return;
  }

  if (pathname === "/api/pipeline") {
    if (req.method === "GET") {
      sendJson(res, 200, await listPipelineItems(getPaginationParams(url)));
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        await upsertPipelineItem({
          auctionKey: body.auctionKey,
          stage: body.stage,
          priority: body.priority,
          source: body.source,
          thesis: body.thesis,
          nextStep: body.nextStep,
          targetBidEur: body.targetBidEur
        });
        const record = await runAutomatedAnalysis(body.auctionKey);
        sendJson(res, 200, record);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }
  }

  if (pathname === "/api/portfolio") {
    const payload = await listPipelineItems({ page: 1, pageSize: 500, scope: "all" });
    sendJson(
      res,
      200,
      payload.items.filter((item) => item.pipeline?.stage === "gekauft")
    );
    return;
  }

  if (pathname.startsWith("/api/auctions/")) {
    const auctionKey = decodeURIComponent(pathname.slice("/api/auctions/".length));

    if (req.method === "GET") {
      const record = await getAuctionByKey(auctionKey);
      if (!record) {
        notFound(res, "Auction not found");
        return;
      }

      sendJson(res, 200, record);
      return;
    }
  }

  const analysisRunMatch = pathname.match(/^\/api\/analysis\/(.+)\/run$/);
  if (analysisRunMatch && req.method === "POST") {
    try {
      const auctionKey = decodeURIComponent(analysisRunMatch[1]);
      const record = await runAutomatedAnalysis(auctionKey);
      sendJson(res, 200, record);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const analysisMatch = pathname.match(/^\/api\/analysis\/(.+)$/);
  if (analysisMatch && req.method === "PUT") {
    try {
      const auctionKey = decodeURIComponent(analysisMatch[1]);
      const body = await readJsonBody(req);
      const record = await updateAuctionAnalysis({
        auctionKey,
        strategyFit: body.strategyFit,
        locationScore: body.locationScore,
        assetScore: body.assetScore,
        executionScore: body.executionScore,
        screening: body.screening,
        finance: body.finance,
        dueDiligence: body.dueDiligence,
        notes: body.notes,
        decision: body.decision
      });
      sendJson(res, 200, record);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/status") {
    sendJson(res, 200, await getStatusPayload());
    return;
  }

  if (pathname === "/api/states") {
    sendJson(res, 200, STATES);
    return;
  }

  if (pathname === "/api/scrape" && req.method === "POST") {
    if (lastStatus.running) {
      sendJson(res, 409, { error: "Scrape already running", status: await getStatusPayload() });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const states = Array.isArray(body.states)
        ? body.states.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
        : undefined;
      const limit =
        body.limit === null || body.limit === undefined || body.limit === ""
          ? null
          : Number.parseInt(String(body.limit), 10);
      const delayMs =
        body.delayMs === null || body.delayMs === undefined || body.delayMs === ""
          ? 350
          : Number.parseInt(String(body.delayMs), 10);

      lastStatus.running = true;
      lastStatus.lastStartedAt = new Date().toISOString();
      lastStatus.error = null;

      sendJson(res, 202, { ok: true, message: "Scrape gestartet", status: await getStatusPayload() });

      runScrape({
        states: states && states.length > 0 ? states : undefined,
        limit,
        delayMs
      }).then((result) => {
        lastStatus.running = false;
        lastStatus.lastFinishedAt = new Date().toISOString();
        lastStatus.lastRunId = result.runId;
        lastStatus.error = null;
        console.log(`Scrape completed: ${result.summary.exportedRecords} records`);
      }).catch((error) => {
        console.error("Scrape failed:", error);
        lastStatus.running = false;
        lastStatus.lastFinishedAt = new Date().toISOString();
        lastStatus.error = error.message;
      });
    } catch (error) {
      console.error("Scrape start failed:", error);
      lastStatus.running = false;
      lastStatus.error = error.message;
      sendJson(res, 500, { error: error.message, status: await getStatusPayload() });
    }
    return;
  }

  if (pathname === "/api/documents") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      sendJson(res, 400, { error: "Missing url parameter" });
      return;
    }

    try {
      const file = await fetchBinary(targetUrl, {
        headers: {
          referer: "https://www.zvg-portal.de/index.php?button=Suchen"
        }
      });
      const headers = {
        "content-type": file.contentType,
        "content-length": file.contentLength ?? String(file.buffer.length),
        "cache-control": "private, max-age=3600"
      };

      if (file.contentDisposition) {
        headers["content-disposition"] = file.contentDisposition;
      }

      res.writeHead(200, headers);
      res.end(file.buffer);
    } catch (error) {
      sendJson(res, 502, { error: error.message, sourceUrl: targetUrl });
    }
    return;
  }

  if (pathname === "/api/detail") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      sendJson(res, 400, { error: "Missing url parameter" });
      return;
    }

    try {
      const html = await fetchDetail(targetUrl);
      send(res, 200, html, "text/html; charset=utf-8");
    } catch (error) {
      sendJson(res, 502, { error: error.message, sourceUrl: targetUrl });
    }
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    await serveStatic(res, path.join(publicDir, "index.html"));
    return;
  }

  if (pathname === "/app.js") {
    await serveStatic(res, path.join(publicDir, "app.js"));
    return;
  }

  if (pathname === "/pipeline" || pathname === "/pipeline.html") {
    await serveStatic(res, path.join(publicDir, "pipeline.html"));
    return;
  }

  if (pathname === "/pipeline.js") {
    await serveStatic(res, path.join(publicDir, "pipeline.js"));
    return;
  }

  if (pathname === "/portfolio" || pathname === "/portfolio.html") {
    await serveStatic(res, path.join(publicDir, "portfolio.html"));
    return;
  }

  if (pathname === "/portfolio.js") {
    await serveStatic(res, path.join(publicDir, "portfolio.js"));
    return;
  }

  send(res, 404, "Not found");
});

server.listen(port, host, () => {
  console.log(`Viewer running at http://${host}:${port}`);
});




