import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FolderOpen,
  Gamepad2,
  Keyboard,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";

type Snapshot = {
  id: string;
  label: string;
  createdAt: string;
  payload: string;
};

type LoadedGame = {
  file: File;
  displayName: string;
  dosSafeFolder: string;
  bootPathCandidates: string[];
};

type EmulatorAdapter = {
  mountZip: (file: File, options: { dosSafeFolder: string }) => Promise<void>;
  sendKey: (key: string) => void;
  saveState: () => Promise<string>;
  loadState: (payload: string) => Promise<void>;
  shutdown?: () => Promise<void>;
};

const SNAPSHOT_STORAGE_KEY = "mobile-dos-emulator.snapshots.v1";
const F_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

function normalizeDosToken(input: string) {
  const withoutExt = input.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (cleaned || "GAME").slice(0, 8);
}

function getDosSafeFolderName(fileName: string) {
  return normalizeDosToken(fileName);
}

function guessBootPathCandidates(fileName: string, folder: string) {
  const stem = normalizeDosToken(fileName);
  return [
    `${folder}\\${stem}.BAT`,
    `${folder}\\${stem}.EXE`,
    `${folder}\\START.BAT`,
    `${folder}\\AUTOEXEC.BAT`,
    `${folder}\\INSTALL.BAT`,
  ];
}

function readSnapshots(): Snapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSnapshots(value: Snapshot[]) {
  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(value));
}

function makeMockAdapter(viewport: HTMLDivElement | null): EmulatorAdapter {
  return {
    async mountZip(file, options) {
      if (!viewport) return;
      viewport.innerHTML = "";
      const screen = document.createElement("div");
      screen.className = "h-full w-full bg-black text-slate-200 flex flex-col items-center justify-center px-4 text-center";
      screen.innerHTML = `
        <div style="color:#67e8f9;font-size:12px;letter-spacing:.35em;text-transform:uppercase;margin-bottom:12px;">Mobile DOS Emulator</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:6px;">${file.name}</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:8px;">Mounted as DOS-safe folder</div>
        <div style="font-family:monospace;font-size:20px;color:#86efac;">${options.dosSafeFolder}</div>
        <div style="max-width:280px;font-size:12px;color:#64748b;line-height:1.5;margin-top:18px;">
          This is a preview shell. The real js-dos runtime gets plugged into the same adapter methods used by the controller and snapshot actions.
        </div>
      `;
      viewport.appendChild(screen);
    },
    sendKey(key) {
      console.log("key", key);
    },
    async saveState() {
      return JSON.stringify({ savedAt: new Date().toISOString() });
    },
    async loadState(payload) {
      console.log("load snapshot", payload);
    },
    async shutdown() {
      if (viewport) viewport.innerHTML = "";
    },
  };
}

function KeyButton({
  label,
  onPress,
  icon,
  className = "",
}: {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onPress}
      className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/90 px-4 text-sm font-semibold tracking-wide text-slate-100 shadow-sm active:scale-[0.98] active:bg-slate-800 ${className}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function MobileDosEmulatorPreview() {
  const [loadedGame, setLoadedGame] = useState<LoadedGame | null>(null);
  const [status, setStatus] = useState("Choose a DOS game ZIP to start the emulator.");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [keyboardMode, setKeyboardMode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenKeyboardRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  useEffect(() => {
    setSnapshots(readSnapshots());
  }, []);

  useEffect(() => {
    adapterRef.current = makeMockAdapter(viewportRef.current);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      const open = vv.height < window.innerHeight * 0.8;
      setKeyboardMode(open || document.activeElement === hiddenKeyboardRef.current);
    };

    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  const snapshotSummary = useMemo(() => {
    if (snapshots.length === 0) return "No snapshots yet";
    return `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}`;
  }, [snapshots]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dosSafeFolder = getDosSafeFolderName(file.name);
    const nextLoadedGame: LoadedGame = {
      file,
      displayName: file.name,
      dosSafeFolder,
      bootPathCandidates: guessBootPathCandidates(file.name, dosSafeFolder),
    };

    setLoadedGame(nextLoadedGame);
    setStatus(`Loading ${file.name} as ${dosSafeFolder}...`);

    try {
      await adapterRef.current?.shutdown?.();
      await adapterRef.current?.mountZip(file, { dosSafeFolder });
      setStatus(`Loaded ${file.name}. ZIP name was normalized to the DOS-safe folder ${dosSafeFolder}.`);
    } catch (error) {
      console.error(error);
      setStatus("The ZIP could not be mounted.");
    }
  }

  function sendKey(key: string) {
    adapterRef.current?.sendKey(key);
    setStatus(`Sent key: ${key}`);
  }

  function openKeyboard() {
    hiddenKeyboardRef.current?.focus();
    setKeyboardMode(true);
  }

  function closeKeyboard() {
    hiddenKeyboardRef.current?.blur();
    setKeyboardMode(false);
  }

  async function saveSnapshot() {
    if (!loadedGame) return;
    const payload = await adapterRef.current?.saveState();
    if (!payload) return;

    const nextSnapshot: Snapshot = {
      id: crypto.randomUUID(),
      label: `${loadedGame.displayName} ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      payload,
    };

    const next = [nextSnapshot, ...snapshots].slice(0, 8);
    setSnapshots(next);
    writeSnapshots(next);
    setStatus(`Saved a snapshot for ${loadedGame.displayName}.`);
  }

  async function loadSnapshot(snapshot: Snapshot) {
    await adapterRef.current?.loadState(snapshot.payload);
    setStatus(`Loaded snapshot from ${new Date(snapshot.createdAt).toLocaleString()}.`);
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-white">
      <input
        ref={hiddenKeyboardRef}
        className="absolute left-[-9999px] top-0 opacity-0"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onBlur={() => setKeyboardMode(false)}
      />

      <div className="mx-auto flex h-full max-w-md flex-col bg-slate-950">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-cyan-300">DosPlay</div>
              <div className="text-sm text-slate-400">Mobile browser emulator shell</div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200"
            >
              <Upload size={16} />
              Load Game
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileSelected} />
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <section className="sticky top-[73px] z-20 bg-slate-950 px-3 pt-3">
            <div className="overflow-hidden rounded-3xl border border-slate-800 bg-black shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
                <span className="truncate">{loadedGame?.displayName || "No game loaded"}</span>
                <span className="font-mono text-cyan-300">{loadedGame?.dosSafeFolder || "READY"}</span>
              </div>
              <div ref={viewportRef} className="aspect-[4/3] w-full bg-black" />
            </div>
          </section>

          <section className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
              {status}
            </div>

            {loadedGame && (
              <div className="mt-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <FolderOpen size={16} />
                  DOS-safe launch mapping
                </div>
                <div className="text-xs text-slate-400">
                  Long ZIP names are intercepted and normalized before the emulator boots the extracted files.
                </div>
                <div className="mt-3 rounded-2xl bg-slate-950 p-3 font-mono text-sm text-emerald-300">
                  {loadedGame.dosSafeFolder}
                </div>
                <div className="mt-3 space-y-2">
                  {loadedGame.bootPathCandidates.map((candidate) => (
                    <div key={candidate} className="rounded-2xl bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
                      {candidate}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Save size={16} />
                  Snapshots
                </div>
                <div className="text-xs text-slate-400">{snapshotSummary}</div>
              </div>

              <button
                disabled={!loadedGame}
                onClick={saveSnapshot}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={16} />
                Save Snapshot
              </button>

              <div className="mt-3 space-y-2">
                {snapshots.map((snapshot) => (
                  <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-950 px-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-200">{snapshot.label}</div>
                      <div className="text-xs text-slate-500">{new Date(snapshot.createdAt).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => loadSnapshot(snapshot)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200"
                    >
                      <RotateCcw size={14} />
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>

        <footer className="sticky bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
          <AnimatePresence mode="wait">
            {keyboardMode ? (
              <motion.div
                key="keyboard-mode"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="space-y-3 px-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
                    <Keyboard size={16} />
                    Keyboard mode
                  </div>
                  <button
                    onClick={closeKeyboard}
                    className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
                  >
                    Close Keyboard
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <div className="flex min-w-max gap-2 pb-1">
                    <button
                      onClick={openKeyboard}
                      className="inline-flex min-h-14 min-w-[132px] items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200"
                    >
                      <Keyboard size={16} />
                      Type
                    </button>
                    {F_KEYS.map((key) => (
                      <KeyButton key={key} label={key} onPress={() => sendKey(key)} className="min-w-[74px]" />
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="controller-mode"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="space-y-3 px-3"
              >
                <div className="overflow-x-auto">
                  <div className="flex min-w-max gap-2 pb-1">
                    <button
                      onClick={openKeyboard}
                      className="inline-flex min-h-14 min-w-[132px] items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200"
                    >
                      <Keyboard size={16} />
                      Type
                    </button>
                    {F_KEYS.map((key) => (
                      <KeyButton key={key} label={key} onPress={() => sendKey(key)} className="min-w-[74px]" />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-[116px_1fr] gap-3">
                  <div className="grid gap-3">
                    <KeyButton label="ENTER" onPress={() => sendKey("ENTER")} className="text-emerald-300" />
                    <KeyButton label="ESC" onPress={() => sendKey("ESC")} className="text-rose-300" />
                    <KeyButton label="SPACE" onPress={() => sendKey("SPACE")} />
                    <KeyButton label="TAB" onPress={() => sendKey("TAB")} className="text-amber-300" />
                  </div>

                  <div className="grid grid-cols-3 grid-rows-3 gap-3">
                    <div />
                    <KeyButton label="Up" onPress={() => sendKey("ARROWUP")} icon={<ArrowUp size={18} />} />
                    <div />
                    <KeyButton label="Left" onPress={() => sendKey("ARROWLEFT")} icon={<ArrowLeft size={18} />} />
                    <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 text-xs text-slate-500">
                      <Gamepad2 size={16} />
                    </div>
                    <KeyButton label="Right" onPress={() => sendKey("ARROWRIGHT")} icon={<ArrowRight size={18} />} />
                    <div />
                    <KeyButton label="Down" onPress={() => sendKey("ARROWDOWN")} icon={<ArrowDown size={18} />} />
                    <div />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </footer>
      </div>
    </div>
  );
}
