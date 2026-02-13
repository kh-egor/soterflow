/**
 * Telegram WebApp SDK integration.
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, any>;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isProgressVisible: boolean;
    isActive: boolean;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    setText(text: string): void;
    setParams(params: Record<string, any>): void;
  };
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
}

let _webapp: TelegramWebApp | null = null;

export function getWebApp(): TelegramWebApp | null {
  if (_webapp) {
    return _webapp;
  }
  if (typeof window !== "undefined" && window.Telegram?.WebApp) {
    _webapp = window.Telegram.WebApp;
    return _webapp;
  }
  return null;
}

export function getInitData(): string {
  return getWebApp()?.initData ?? "";
}

export function isDark(): boolean {
  return getWebApp()?.colorScheme === "dark";
}

export function haptic(type: "light" | "medium" | "heavy" = "light") {
  getWebApp()?.HapticFeedback.impactOccurred(type);
}

export function hapticNotify(type: "success" | "error" | "warning" = "success") {
  getWebApp()?.HapticFeedback.notificationOccurred(type);
}

export function showBackButton(cb: () => void) {
  const wa = getWebApp();
  if (!wa) {
    return;
  }
  wa.BackButton.onClick(cb);
  wa.BackButton.show();
  return () => {
    wa.BackButton.offClick(cb);
    wa.BackButton.hide();
  };
}

export function initApp() {
  const wa = getWebApp();
  if (!wa) {
    return;
  }
  wa.ready();
  wa.expand();
}
