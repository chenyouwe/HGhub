import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, type Page, type Tab } from "./store";
import { selfTest } from "./api";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { runBack } from "./back";
import Home from "./pages/Home";
import Search, { RankPage } from "./pages/Search";
import Category, { ChannelPage } from "./pages/Category";
import Profile from "./pages/Profile";
import Feed from "./components/Feed";
import { PostsPage, PostDetail } from "./pages/Posts";
import CalculatorLock from "./components/CalculatorLock";
import { ToastHost } from "./components/ui";
import { DesktopRail, DesktopTitleBar } from "./components/DesktopChrome";
import ResizeHandles from "./components/ResizeHandles";
import { IGrid, IGridF, IHome, IHomeF, ISearch, IUser, IUserF, Logo } from "./icons";

/* ============ 底部标签栏（Android）—— 悬浮半透明毛玻璃胶囊 ============ */
function TabBar() {
  const { tab, setTab } = useStore();
  const items: { k: Tab; label: string; Icon: typeof IHome; Filled: typeof IHomeF }[] = [
    { k: "home", label: "首页", Icon: IHome, Filled: IHomeF },
    { k: "search", label: "搜索", Icon: ISearch, Filled: ISearch },
    { k: "category", label: "分类", Icon: IGrid, Filled: IGridF },
    { k: "profile", label: "我的", Icon: IUser, Filled: IUserF },
  ];
  const onVideo = tab === "home";
  return (
    <nav
      aria-label="底部导航"
      className="absolute inset-x-0 z-30 px-4 pointer-events-none flex justify-center"
      style={{ bottom: "calc(var(--sab, 0px) + 10px)" }}>
      <div className={`pointer-events-auto w-full max-w-[376px] h-[54px] rounded-full glass-pill ${onVideo ? "is-video-pill" : ""} p-1.5 flex items-center gap-1`}>
        {items.map(({ k, label, Icon, Filled }) => {
          const on = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`relative flex-1 h-full rounded-full flex flex-col items-center justify-center gap-0.5 pressable transition-all duration-200 ${
                on
                  ? "bg-gradient-to-b from-[#ff5e3a]/24 to-[#ff2a55]/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                  : onVideo
                    ? "text-white/60 hover:text-white/85"
                    : "text-mut hover:text-on"
              }`}>
              <span className={`transition-transform duration-200 ${on ? "scale-105 text-[#ff6442]" : ""}`}>
                {on ? <Filled size={18} strokeWidth={2.2} /> : <Icon size={18} strokeWidth={1.85} />}
              </span>
              <span
                className={`text-[10.5px] leading-none tracking-wide transition-colors duration-200 ${
                  on
                    ? onVideo ? "font-bold text-white" : "font-bold text-on"
                    : "font-medium"
                }`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============ 堆栈页面 ============ */
function StackPage({ page, onBack, wide, top, bottomInset }: {
  page: Page; onBack: () => void; wide: boolean; top: boolean; bottomInset: number;
}) {
  if (page.kind === "feed") {
    return (
      <Feed videoIds={page.videoIds} startIndex={page.index} title={page.title} kind={page.feedKind || "video"}
        mode="context" active={top} bottomInset={bottomInset} onBack={onBack} />
    );
  }
  if (page.kind === "channel") return <ChannelPage cate={page.cate} name={page.name} onBack={onBack} wide={wide} />;
  if (page.kind === "ranks") return <RankPage onBack={onBack} wide={wide} />;
  if (page.kind === "posts") return <PostsPage onBack={onBack} wide={wide} />;
  if (page.kind === "post") return <PostDetail id={page.id} onBack={onBack} />;
  return null;
}

/* ============ 应用主体 ============ */
function AppBody() {
  const { platform, tab, setTab, stack, pop, fs, disguiseLocked, toast } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(platform !== "android");
  const [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  /* 全局键盘 */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (disguiseLocked) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["home", "search", "category", "profile"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, disguiseLocked]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !disguiseLocked;
  /* 悬浮毛玻璃胶囊高 54px + 底距 10px = 64px，进度条上移至 78px 处留出充足防误触安全区 */
  const bottomInset = platform === "android" ? (fs ? 0 : 78) : 14;
  /* 栈页（从搜索/分类/我的进入的播放页、图文页）不显示底栏：
     底栏会盖住评论抽屉的输入框，且这些页面本身是沉浸的 */
  const stackInset = platform === "android" ? (fs ? 0 : 24) : 14;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {platform !== "android" && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className="relative flex-1 min-w-0 overflow-hidden win-main">
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={bottomInset} /></div>
        <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>
        <div className={vis("category")}><Category wide={wide} /></div>
        <div className={vis("profile")}><Profile wide={wide} bottomInset={bottomInset} /></div>

        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg a-page-in" style={{ boxShadow: "-18px 0 40px rgba(0,0,0,.5)" }}>
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1 && !disguiseLocked} bottomInset={stackInset} />
          </div>
        ))}

        {platform === "android" && !fs && stack.length === 0 && <TabBar />}
      </div>
    </div>
  );
}

/* ============ 桌面窗口壳（Windows / macOS）============ */
function DesktopShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { theater, platform } = useStore();
  return (
    <div className={`absolute inset-0 flex flex-col bg-canvas win-root plat-${platform}`}>
      <DesktopTitleBar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="relative flex-1 min-h-0">
        <ShellInner collapsed={collapsed || theater} theater={theater} />
      </div>
      {/* 边缘缩放热区只对无边框窗口（Windows）有效，macOS 走原生窗口边框 */}
      {platform === "windows" && <ResizeHandles />}
    </div>
  );
}

function ShellInner({ collapsed, theater }: { collapsed: boolean; theater: boolean }) {
  const { stack, pop, tab, setTab, platform, disguiseLocked } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (disguiseLocked) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["home", "search", "category", "profile"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, disguiseLocked]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !disguiseLocked;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {!theater && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className={`relative flex-1 min-w-0 overflow-hidden win-main ${theater ? "is-theater-main" : ""}`}>
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={14} /></div>
        <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>
        <div className={vis("category")}><Category wide={wide} /></div>
        <div className={vis("profile")}><Profile wide={wide} /></div>
        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg win-page-in" style={{ boxShadow: "-18px 0 40px rgba(0,0,0,.5)" }}>
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1 && !disguiseLocked} bottomInset={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ 移动端（无壳） ============ */
function MobileShell() {
  return (
    <div className="absolute inset-0 flex flex-col bg-canvas plat-android"
      style={{ "--sat": "max(env(safe-area-inset-top), 8px)", "--sab": "max(env(safe-area-inset-bottom), 6px)" } as React.CSSProperties}>
      <div className="relative flex-1 min-h-0">
        <AppBody />
      </div>
    </div>
  );
}

/* ============ 入口 ============ */
export default function App() {
  const { platform, tab, setTab, stack, pop, fs, setFs, disguiseLocked, toast } = useStore();
  const lastBackTime = useRef(0);

  /* —— 安卓硬件返回键 ——
     层级：计算器伪装层 → 全屏 → 面板/弹层 → 页面栈 → 回首页 → 双击防误退退出。 */
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (disguiseLocked) {
      invoke("plugin:app|exit", { code: 0 }).catch(() => {});
      return;
    }
    if (fs) { setFs(false); return; }                        // 沉浸全屏
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    if (runBack()) return;                                  // 播放器的选集/评论/图文面板
    if (stack.length) { pop(); return; }
    if (tab !== "home") { setTab("home"); return; }
    const now = Date.now();
    if (now - lastBackTime.current < 2000) {
      invoke("plugin:app|exit", { code: 0 }).catch(() => {});
    } else {
      lastBackTime.current = now;
      toast("再按一次退出黄果", "info");
    }
  };

  useEffect(() => {
    if (platform !== "android") return undefined;
    let disposed = false;
    let handle: { unregister: () => Promise<void> } | null = null;
    addPluginListener("app", "back-button", () => backRef.current())
      .then((l) => { if (disposed) l.unregister().catch(() => {}); else handle = l; })
      .catch(() => { /* 非安卓宿主忽略 */ });
    return () => {
      disposed = true;
      handle?.unregister().catch(() => {});
    };
  }, [platform]);

  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = window.setTimeout(() => {
      selfTest().then((r) => { invoke("debug_log", { msg: r }).catch(() => {}); }).catch(() => {});
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {platform === "android" ? <MobileShell /> : <DesktopShell />}
      <CalculatorLock />
      <ToastHost />
    </>
  );
}