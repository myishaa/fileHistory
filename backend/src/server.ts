import cors from "cors";
import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { divisionsRouter } from "./routes/divisions.js";
import { exportsRouter } from "./routes/exports.js";
import { filesRouter } from "./routes/files.js";
import { healthRouter } from "./routes/health.js";
import { indentorsRouter } from "./routes/indentors.js";
import { liveRouter } from "./routes/live.js";
import { messagesRouter } from "./routes/messages.js";
import { reportsRouter } from "./routes/reports.js";
import { settingsRouter } from "./routes/settings.js";
import { usersRouter } from "./routes/users.js";
import { attachAuthUser } from "./utils/auth.js";
import { HttpError } from "./utils/http.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedFrontendOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (frontendOrigins.includes(origin)) return true;
  if (isProduction) return false;
  return (
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ||
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)
  );
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedFrontendOrigin(origin));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "15mb" }));
app.use(attachAuthUser);

app.get("/", (_request, response) => {
  response.json({ ok: true, service: "recordkeeper-backend" });
});

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/divisions", divisionsRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/indentors", indentorsRouter);
app.use("/api/live", liveRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/users", usersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/files", filesRouter);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);
  const status = error instanceof HttpError ? error.status : 500;
  response.status(status).json({
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected server error",
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Recordkeeper backend listening on http://localhost:${port}`);
});
