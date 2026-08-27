import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// When SkinTune is deployed as a single Render web service, the frontend's
// production build is copied into this container at STATIC_DIR (see the
// repo-root Dockerfile) and Express serves it directly alongside /api/*.
// In any environment where that directory isn't present (e.g. local API-only
// dev), static serving is simply skipped — this file never assumes a
// frontend build exists.
// Default (no STATIC_DIR set) assumes the layout the Dockerfile produces:
// the bundled server at <app>/dist/index.mjs and the frontend build at
// <app>/public, i.e. a sibling of dist, not nested inside it.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir =
  process.env["STATIC_DIR"] ?? path.resolve(currentDir, "..", "public");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (existsSync(staticDir)) {
  app.use(express.static(staticDir));

  // SPA fallback: any non-API, non-file route resolves to index.html so
  // client-side navigation (and hard refreshes on a deep state) still work.
  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (path.extname(req.path)) {
      // Let a request for a real static asset (e.g. /assets/x.js) 404
      // naturally instead of being swallowed by the SPA fallback.
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn(
    { staticDir },
    "No frontend build found at STATIC_DIR; serving API only.",
  );
}

export default app;
