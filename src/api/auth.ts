/**
 * @module api/auth
 * Telegram Mini App initData validation using HMAC-SHA256.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { env } from "../soterflow-env.js";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface AuthedRequest extends Request {
  telegramUser?: TelegramUser;
}

/**
 * Validate Telegram WebApp initData string.
 * See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string, botToken: string): TelegramUser | null {
  if (!initData || !botToken) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return null;
  }

  // Build data-check-string: sorted key=value pairs, excluding hash
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // secret_key = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) {
    return null;
  }

  // Check auth_date freshness (allow 1 hour)
  const authDate = params.get("auth_date");
  if (authDate) {
    const age = Math.floor(Date.now() / 1000) - parseInt(authDate, 10);
    if (age > 3600) {
      return null;
    }
  }

  // Extract user
  const userStr = params.get("user");
  if (!userStr) {
    return null;
  }

  try {
    return JSON.parse(userStr) as TelegramUser;
  } catch {
    return null;
  }
}

/**
 * Express middleware: validates Telegram initData on every request except GET /api/health.
 * Expects initData in Authorization header as "tma <initData>".
 */
export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  // Skip health check
  if (req.path === "/api/health") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("tma ")) {
    res.status(401).json({ ok: false, error: "Missing Telegram auth" });
    return;
  }

  const initData = authHeader.slice(4);
  const user = validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!user) {
    res.status(401).json({ ok: false, error: "Invalid Telegram auth" });
    return;
  }

  req.telegramUser = user;
  next();
}
