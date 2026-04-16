import "dotenv/config";
import path from "node:path";
import { handleRequest } from "../src/app.js";

export default async function handler(req, res) {
  try {
    await handleRequest(req, res, {
      publicDir: path.join(process.cwd(), "public")
    });
  } catch (error) {
    console.error("Vercel request failed:", error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error: error.message }));
  }
}
