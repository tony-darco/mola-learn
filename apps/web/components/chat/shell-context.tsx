"use client";

import { createContext, useContext } from "react";

/**
 * Lets content nested under AppShell (a chat sending its first message, a
 * course starting a new one) ask the persistent sidebar to re-fetch its chat
 * list — e.g. once a chat's title changes from "New chat" to something real.
 */
export const RefreshSidebarContext = createContext<() => void>(() => {});

export const useRefreshSidebar = () => useContext(RefreshSidebarContext);
