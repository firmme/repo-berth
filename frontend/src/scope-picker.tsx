import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Folders,
  FolderGit2,
  FolderOpen,
  Cloud,
  Clock3,
  Star,
  Folder,
} from "lucide-react";
import { AccountAvatar } from "./components";
import type { State } from "./types";

export function ScopePicker({
  state,
  value,
  onChange,
}: {
  state: State;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = [
    { id: "all", label: "全部仓库", icon: <Folders size={16} /> },
    { id: "local", label: "本地 Git 仓库", icon: <FolderGit2 size={16} /> },
    { id: "cloud", label: "云端仓库", icon: <Cloud size={16} /> },
    { id: "plain", label: "普通目录", icon: <FolderOpen size={16} /> },
    { id: "favorite", label: "收藏", icon: <Star size={16} /> },
    { id: "recent", label: "最近访问", icon: <Clock3 size={16} /> },
    ...state.accounts.map((a) => ({
      id: `account:${a.id}`,
      label: a.login + (a.note ? ` · ${a.note}` : ""),
      icon: <AccountAvatar account={a} size={20} />,
    })),
    ...state.groups.map((g) => ({
      id: `group:${g.id}`,
      label: g.name,
      icon: <Folder size={16} />,
    })),
  ];
  const selected = items.find((i) => i.id === value) || items[0];
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="scope-picker"
      ref={root}
      onKeyDown={(e) => {
        const options = Array.from(
          root.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ) || [],
        );
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
                ?.focus(),
            );
            return;
          }
          const i = options.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const n =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? options.length - 1
                : e.key === "ArrowDown"
                  ? (i + 1) % options.length
                  : (i - 1 + options.length) % options.length;
          options[n]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="scope-picker-trigger"
        aria-label="按账号或分组筛选"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected.icon}
        <span>{selected.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="scope-picker-options"
          role="menu"
          aria-label="仓库类型与账号"
        >
          {items.map((i) => (
            <button
              type="button"
              key={i.id}
              role="menuitemradio"
              aria-checked={value === i.id}
              onClick={() => {
                onChange(i.id);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {i.icon}
              <span>{i.label}</span>
              {value === i.id && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
