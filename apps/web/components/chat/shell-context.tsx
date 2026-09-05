"use client";

import { createContext, useContext } from "react";
import type { SettingsSection } from "./SettingsModal";

/**
 * Lets content nested under AppShell (a chat sending its first message, a
 * course starting a new one) ask the persistent sidebar to re-fetch its chat
 * list — e.g. once a chat's title changes from "New chat" to something real.
 */
export const RefreshSidebarContext = createContext<() => void>(() => {});

export const useRefreshSidebar = () => useContext(RefreshSidebarContext);

/**
 * Lets content nested under AppShell (the sidebar's own menu, a course
 * page's breadcrumb) open the settings modal to a specific section without
 * needing it passed down as a prop through every layer.
 */
export const OpenSettingsContext = createContext<(section?: SettingsSection) => void>(() => {});

export const useOpenSettings = () => useContext(OpenSettingsContext);

/**
 * Custom replacement for `window.confirm` (native browser dialogs can't be
 * styled or positioned, and block on the main thread) — resolves true/false
 * once the student picks an icon on the confirm card ConfirmProvider renders.
 * Anything under AppShell needing a confirmation calls this the same way.
 */
export const ConfirmContext = createContext<(message: string) => Promise<boolean>>(async () => {
  console.error("useConfirm() called outside a ConfirmProvider");
  return false;
});

export const useConfirm = () => useContext(ConfirmContext);

/**
 * Custom replacement for `window.prompt` (native browser dialogs can't be
 * styled or positioned, and block on the main thread) — resolves the typed
 * value once the student submits the prompt card PromptProvider renders, or
 * null if they cancel. Anything under AppShell needing typed input calls
 * this the same way.
 */
export const PromptContext = createContext<(message: string, defaultValue: string) => Promise<string | null>>(async () => {
  console.error("usePrompt() called outside a PromptProvider");
  return null;
});

export const usePrompt = () => useContext(PromptContext);

/**
 * The floating calculator's open/closed state (§ calculator feature) — a
 * global toggle rather than composer-local state, since the widget is a
 * draggable window that floats above the whole app, not scoped to whichever
 * composer's "Calculator" button opened it. Mounted once in AppShell.
 */
export const CalculatorContext = createContext<{ open: boolean; toggle: () => void }>({
  open: false,
  toggle: () => console.error("useCalculator() called outside a CalculatorProvider"),
});

export const useCalculator = () => useContext(CalculatorContext);
