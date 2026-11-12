import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, platform as envPlatform } from "./api";

export type Platform = "android" | "windows" | "macos";
export type Theme = "dark" | "light";
export type Tab = "home" | "search" | "category" | "profile";

/** 播放页上下文：ids 是来源列表，index 是当前条目。 */
export type FeedContext = {
  kind: "feed";
  key: string;
  videoIds: number[];
  index: number;
  title: string;
  source: string;
  feedKind?: "video" | "post";
};

export type Page =
  | FeedContext
  | { kind: "channel"; key: string; cate: string; name: string }
  | { kind: "ranks"; key: string }
  | { kind: "posts"; key: string }
  | { kind: "post"; key: string; id: number };

export type PageInput =
  | { kind: "feed"; videoIds: number[]; index: number; title: string; source?: string; feedKind?: "video" | "post" }
  | { kind: "channel"; cate: string; name: string }
  | { kind: "ranks" }
  | { kind: "posts" }
  | { kind: "post"; id: number };

export type Toast = { id: number; msg: string; icon?: "ok" | "heart" | "star" | "info" };

export type WatchProgress = {
  ep: number;
  time: number;
  totalEp?: number;
  updatedAt: number;
};

type Persist = {
  likes: number[];
  favs: number[];
  history: number[];
  follows: number[];
  muted: boolean;
  volume: number;
  searchHist: string[];
  progress: Record<number, WatchProgress>;
  disguiseEnabled: boolean;
  disguisePin: string;
  disguiseIconSync: boolean;
};

const LS = "hghub_app_v1";
const DEFAULTS: Persist = {
  likes: [], favs: [], history: [], follows: [],
  muted: true, volume: 0.7, searchHist: [],
  progress: {},
  disguiseEnabled: false,
  disguisePin: "8888",
  disguiseIconSync: false,
};

function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(LS);
    const parsed = raw ? (JSON.parse(raw) as Partial<Persist>) : {};
    // 只保留当前支持的本机设置，升级时清除已移除功能的旧数据。
    return Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, value]) => [key, parsed[key as keyof Persist] ?? value]),
    ) as Persist;
  } catch {
    return { ...DEFAULTS };
  }
}

function readTheme(): Theme {
  try {
    return localStorage.getItem("hghub_theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("theme-light", theme === "light");
  document.documentElement.style.colorScheme = theme;
}

type Store = {
  platform: Platform;
  theme: Theme; setTheme: (t: Theme) => void;
  tab: Tab; setTab: (t: Tab) => void;
  stack: Page[]; push: (p: PageInput) => void; pop: () => void;
  likes: number[]; favs: number[]; history: number[]; follows: number[];
  isLiked: (id: number) => boolean; isFav: (id: number) => boolean;
  toggleLikeLocal: (id: number) => boolean;
  toggleFavLocal: (id: number) => boolean;
  addHistory: (id: number) => void;
  clearHistory: () => void;
  clearLocal: () => void;
  toggleFollowLocal: (uid: number) => boolean;
  theater: boolean; setTheater: (v: boolean | ((p: boolean) => boolean)) => void;
  fs: boolean; setFs: (v: boolean | ((p: boolean) => boolean)) => void;
  muted: boolean; setMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  volume: number; setVolume: (v: number) => void;
  searchHist: string[]; addSearch: (q: string) => void; clearSearchHist: () => void;
  toasts: Toast[]; toast: (msg: string, icon?: Toast["icon"]) => void;
  /* 剧集断点续播进度 */
  progress: Record<number, WatchProgress>;
  saveProgress: (id: number, ep: number, time: number, totalEp?: number, force?: boolean) => void;
  getProgress: (id: number) => WatchProgress | undefined;
  /* 防查岗计算器伪装模式 */
  disguiseEnabled: boolean;
  disguisePin: string;
  disguiseLocked: boolean;
  disguiseIconSync: boolean;
  setDisguiseEnabled: (on: boolean) => void;
  setDisguisePin: (pin: string) => void;
  setDisguiseIconSync: (on: boolean) => void;
  lockDisguiseNow: () => void;
  unlockDisguise: (inputPin: string) => boolean;
};

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);
let seq = 0;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [p, setP] = useState<Persist>(loadPersist);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [tab, setTabRaw] = useState<Tab>("home");
  const [stack, setStack] = useState<Page[]>([]);
  const [disguiseLocked, setDisguiseLocked] = useState<boolean>(() => !!loadPersist().disguiseEnabled);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theater, setTheaterState] = useState(false);
  const [fs, setFsState] = useState(false);
  const toastSeq = useRef(0);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem("hghub_theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* ignore */ }
  }, [p]);

  const toast = useCallback((msg: string, icon?: Toast["icon"]) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, msg, icon }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  const setTab = useCallback((t: Tab) => { setTabRaw(t); setStack([]); }, []);
  const push = useCallback((pg: PageInput) => {
    setStack((s) => [...s, { ...pg, key: `p${++seq}` } as Page]);
  }, []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const toggleLikeLocal = useCallback((id: number) => {
    let on = false;
    setP((s) => {
      on = !s.likes.includes(id);
      return { ...s, likes: on ? [id, ...s.likes] : s.likes.filter((x) => x !== id) };
    });
    return on;
  }, []);
  const toggleFavLocal = useCallback((id: number) => {
    let on = false;
    setP((s) => {
      on = !s.favs.includes(id);
      return { ...s, favs: on ? [id, ...s.favs] : s.favs.filter((x) => x !== id) };
    });
    return on;
  }, []);
  const toggleFollowLocal = useCallback((uid: number) => {
    let on = false;
    setP((s) => {
      on = !s.follows.includes(uid);
      return { ...s, follows: on ? [uid, ...s.follows] : s.follows.filter((x) => x !== uid) };
    });
    return on;
  }, []);
  const addHistory = useCallback((id: number) => {
    setP((s) => ({ ...s, history: [id, ...s.history.filter((x) => x !== id)].slice(0, 80) }));
  }, []);
  const clearHistory = useCallback(() => setP((s) => ({ ...s, history: [], progress: {} })), []);
  const clearLocal = useCallback(() => setP((s) => ({ ...s, likes: [], favs: [], history: [], searchHist: [], progress: {} })), []);
  const saveProgress = useCallback((id: number, ep: number, time: number, totalEp?: number, force = false) => {
    if (!id || ep < 1) return;
    setP((s) => {
      const prev = s.progress?.[id];
      const cleanTime = Math.max(0, Math.floor(time));
      if (
        !force &&
        prev &&
        prev.ep === ep &&
        Math.abs(prev.time - cleanTime) < 3 &&
        (!totalEp || prev.totalEp === totalEp)
      ) {
        return s;
      }
      return {
        ...s,
        progress: {
          ...(s.progress || {}),
          [id]: {
            ep,
            time: cleanTime,
            totalEp: totalEp || prev?.totalEp,
            updatedAt: Date.now(),
          },
        },
      };
    });
  }, []);
  const getProgress = useCallback((id: number) => p.progress?.[id], [p.progress]);
  const addSearch = useCallback((q: string) => {
    const t = q.trim();
    if (!t) return;
    setP((s) => ({ ...s, searchHist: [t, ...s.searchHist.filter((x) => x !== t)].slice(0, 12) }));
  }, []);
  const clearSearchHist = useCallback(() => setP((s) => ({ ...s, searchHist: [] })), []);

  const setTheater = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTheaterState((prev) => (typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v));
  }, []);

  const setFs = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setFsState((prev) => (typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v));
  }, []);

  const setMuted = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setP((s) => ({ ...s, muted: typeof v === "function" ? v(s.muted) : v }));
  }, []);
  const setVolume = useCallback((v: number) => {
    const volume = Math.max(0, Math.min(1, v));
    setP((s) => ({ ...s, volume, muted: volume === 0 }));
  }, []);

  const disguisePin = p.disguisePin || "8888";

  const pauseAllVideos = useCallback(() => {
    try {
      document.querySelectorAll("video").forEach((v) => {
        try { v.pause(); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  }, []);

  const setDisguiseEnabled = useCallback((on: boolean) => {
    setP((s) => ({ ...s, disguiseEnabled: on, disguisePin: s.disguisePin || "8888" }));
    if (!on) {
      setDisguiseLocked(false);
      if (p.disguiseIconSync) {
        api.setLauncherIcon("default");
      }
    } else if (p.disguiseIconSync) {
      api.setLauncherIcon("calc");
    }
  }, [p.disguiseIconSync]);

  const setDisguiseIconSync = useCallback((on: boolean) => {
    setP((s) => ({ ...s, disguiseIconSync: on }));
    if (on) {
      api.setLauncherIcon("calc");
    } else {
      api.setLauncherIcon("default");
    }
  }, []);

  const setDisguisePin = useCallback((pin: string) => {
    const clean = pin.replace(/\D/g, "").slice(0, 8);
    if (clean.length < 3) return;
    setP((s) => ({ ...s, disguisePin: clean }));
  }, []);

  const lockDisguiseNow = useCallback(() => {
    pauseAllVideos();
    setP((s) => ({ ...s, disguiseEnabled: true, disguisePin: s.disguisePin || "8888" }));
    setDisguiseLocked(true);
    if (p.disguiseIconSync) {
      api.setLauncherIcon("calc");
    }
  }, [pauseAllVideos, p.disguiseIconSync]);

  const unlockDisguise = useCallback((inputPin: string): boolean => {
    const target = p.disguisePin || "8888";
    if (inputPin === target) {
      setDisguiseLocked(false);
      toast("已解除计算器伪装", "ok");
      return true;
    }
    return false;
  }, [p.disguisePin, toast]);

  /* 开启伪装模式后：只要切后台或息屏，0.1秒内自动暂停所有视频并重新锁回计算器界面 */
  useEffect(() => {
    if (!p.disguiseEnabled) return undefined;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        pauseAllVideos();
        setDisguiseLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [p.disguiseEnabled, pauseAllVideos]);

  const value = useMemo<Store>(() => ({
    platform: envPlatform,
    theme, setTheme: setThemeState,
    tab, setTab, stack, push, pop,
    likes: p.likes, favs: p.favs, history: p.history, follows: p.follows,
    isLiked: (id) => p.likes.includes(id),
    isFav: (id) => p.favs.includes(id),
    toggleLikeLocal, toggleFavLocal, toggleFollowLocal, addHistory, clearHistory, clearLocal,
    muted: p.muted, setMuted, volume: p.volume, setVolume, theater, setTheater, fs, setFs,
    searchHist: p.searchHist, addSearch, clearSearchHist,
    toasts, toast,
    progress: p.progress || {},
    saveProgress,
    getProgress,
    disguiseEnabled: !!p.disguiseEnabled,
    disguisePin,
    disguiseLocked,
    disguiseIconSync: !!p.disguiseIconSync,
    setDisguiseEnabled,
    setDisguisePin,
    setDisguiseIconSync,
    lockDisguiseNow,
    unlockDisguise,
  }), [theme, tab, setTab, stack, push, pop,
    p, toggleLikeLocal, toggleFavLocal, toggleFollowLocal, addHistory, clearHistory, clearLocal,
    setMuted, setVolume, addSearch, clearSearchHist, toasts, toast, theater, setTheater, fs, setFs,
    saveProgress, getProgress,
    disguisePin, disguiseLocked, setDisguiseEnabled, setDisguisePin, setDisguiseIconSync, lockDisguiseNow, unlockDisguise]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
