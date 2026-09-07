"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useConfirm, usePrompt } from "./shell-context";
import type { ChatSummary, CourseSummary } from "./types";

interface ChatContextMenuProps {
  chat: ChatSummary;
  courses: CourseSummary[];
  onUpdate: (updates: { title?: string; courseId?: string | null; isPinned?: boolean }) => Promise<void>;
  onDelete: () => Promise<void>;
}

const MENU_WIDTH = 192; // w-48
const GAP = 4;

export function ChatContextMenu({ chat, courses, onUpdate, onDelete }: ChatContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"courses" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Anchored to the viewport (position: fixed) rather than to this row, and
  // rendered through a portal into <body> — the Chats list scrolls in its
  // own overflow-y-auto box now (independent of the rest of the sidebar), and
  // any ancestor with overflow-y set to anything but visible clips an
  // absolutely-positioned descendant that extends past its bounds, no matter
  // its z-index. A menu that opens upward from a row near the top of that
  // box was getting cut off by the box's own edge. Escaping to a portal
  // sidesteps every such ancestor, present or future.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; openUpward: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  // Recomputed every time the menu opens — a fixed-position element doesn't
  // need to track scroll (closing on scroll, below, is simpler and matches
  // how a native context menu behaves), but the trigger's position on screen
  // can differ between opens (list scrolled, window resized).
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const openUpward = rect.top > window.innerHeight / 2;
    setMenuPos({
      top: openUpward ? window.innerHeight - rect.top + GAP : rect.bottom + GAP,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - GAP),
      openUpward,
    });
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
      setSubmenu(null);
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // A fixed-position menu stays glued to the same screen coordinates while
  // the row it belongs to scrolls out from under it — close instead of
  // letting it drift away from its trigger.
  useEffect(() => {
    if (!isOpen) return;
    function handleScroll() {
      setIsOpen(false);
      setSubmenu(null);
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [isOpen]);

  const handlePin = async () => {
    setIsLoading(true);
    try {
      await onUpdate({ isPinned: !chat.isPinned });
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMoveToCourse = async (courseId: string | null) => {
    setIsLoading(true);
    try {
      await onUpdate({ courseId });
      setIsOpen(false);
      setSubmenu(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRename = async () => {
    const newTitle = await prompt("Rename chat:", chat.title);
    if (newTitle && newTitle !== chat.title) {
      setIsLoading(true);
      try {
        await onUpdate({ title: newTitle });
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async () => {
    if (await confirm(`Delete "${chat.title}"? This cannot be undone.`)) {
      setIsLoading(true);
      try {
        await onDelete();
        setIsOpen(false);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Keyboard shortcuts (P/M/R/D) shown next to each item, only live while
  // the menu is open — matches the click behavior of each action, so "M"
  // opens the course submenu rather than guessing which course.
  useEffect(() => {
    if (!isOpen || submenu) return;
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key.toLowerCase()) {
        case "p":
          e.preventDefault();
          void handlePin();
          break;
        case "m":
          e.preventDefault();
          setSubmenu("courses");
          break;
        case "r":
          e.preventDefault();
          void handleRename();
          break;
        case "d":
          e.preventDefault();
          void handleDelete();
          break;
        case "escape":
          setIsOpen(false);
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, submenu]);

  const pinLabel = chat.isPinned ? "Unpin" : "Pin";
  const pinKeyboard = "P";
  const moveKeyboard = "M";
  const renameKeyboard = "R";
  const deleteKeyboard = "D";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="hidden p-1 text-fg-muted hover:text-fg group-hover:flex"
        title="Chat actions"
        aria-label="Chat actions"
        disabled={isLoading}
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {isOpen && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menuPos.left,
            width: MENU_WIDTH,
            ...(menuPos.openUpward ? { bottom: menuPos.top } : { top: menuPos.top }),
          }}
          className="z-50 rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {/* Pin option */}
          <button
            onClick={handlePin}
            disabled={isLoading}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-base text-fg hover:bg-bg disabled:opacity-50"
          >
            <span>{pinLabel}</span>
            <span className="text-sm text-fg-muted">{pinKeyboard}</span>
          </button>

          {/* Move to course option — expands in place rather than flying out
              sideways, since a flyout could render past the viewport edge. */}
          <div>
            <button
              onClick={() => setSubmenu(submenu === "courses" ? null : "courses")}
              disabled={isLoading}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-base text-fg hover:bg-bg disabled:opacity-50"
            >
              <span>Move to course</span>
              <span className="flex items-center gap-1">
                <span className="text-sm text-fg-muted">{moveKeyboard}</span>
                <span className={`text-fg-muted transition-transform ${submenu === "courses" ? "rotate-90" : ""}`}>›</span>
              </span>
            </button>

            {submenu === "courses" && (
              <div className="max-h-40 overflow-y-auto border-t border-border pl-2">
                <button
                  onClick={() => handleMoveToCourse(null)}
                  disabled={isLoading}
                  className="flex w-full items-start rounded-md px-2.5 py-1.5 text-left text-base text-fg hover:bg-bg disabled:opacity-50"
                >
                  <span className="flex-1">General (no course)</span>
                  {chat.courseId === null && <span className="ml-2 text-accent">✓</span>}
                </button>
                {courses.map((course) => (
                  <button
                    key={course.id}
                    onClick={() => handleMoveToCourse(course.id)}
                    disabled={isLoading}
                    className="flex w-full items-start rounded-md px-2.5 py-1.5 text-left text-base text-fg hover:bg-bg disabled:opacity-50"
                  >
                    <span className="flex-1 truncate">
                      {course.number ? `${course.number} ` : ""}
                      {course.name}
                    </span>
                    {chat.courseId === course.id && <span className="ml-2 text-accent">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rename option */}
          <button
            onClick={handleRename}
            disabled={isLoading}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-base text-fg hover:bg-bg disabled:opacity-50"
          >
            <span>Rename</span>
            <span className="text-sm text-fg-muted">{renameKeyboard}</span>
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-border" />

          {/* Delete option */}
          <button
            onClick={handleDelete}
            disabled={isLoading}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-base text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 disabled:opacity-50"
          >
            <span>Delete</span>
            <span className="text-sm text-fg-muted">{deleteKeyboard}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
