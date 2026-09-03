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
