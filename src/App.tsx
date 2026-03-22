import { analyzeZipNatively, type LaunchCandidate } from "./nativeZipAnalyzer";
// @ts-ignore
declare const Dos: any;

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FolderOpen,
  Gamepad2,
  Keyboard,
  Play,
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

type LaunchCandidate = {
  zipPath: string;
  relativePath: string;
  displayPath: string;
  relativeDir: string;
  fileName: string;
  dosAliasDir: string;
  dosAliasFile: string;
  score: number;
  reason: string;
};

type LoadedGame = {
  file: File;
  displayName: string;
  dosSafeFolder: string;
  launchCandidates: LaunchCandidate[];
  selectedBootPath?: string;
};

type EmulatorAdapter = {
  mountZip: (
    file: File,
    options: {
      dosSafeFolder: string;
      launchDir: string;
      launchFile: string;
    }
  ) => Promise<void>;
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

function stripCommonTopLevelFolder(paths: string[]) {
  const splitPaths = paths.map((p) => p.split("/").filter(Boolean));
  if (splitPaths.length === 0) return paths;

  const firstSegment = splitPaths[0][0];
  if (!firstSegment) return paths;

  const allShareFirst =
    splitPaths.every((parts) => parts.length > 1 && parts[0] === firstSegment);

  if (!allShareFirst) return paths;

  return splitPaths.map((parts) => parts.slice(1).join("/"));
}

function toDosShortSegment(segment: string) {
  const upper = segment.toUpperCase();
  const parts = upper.split(".");
  const name = (parts[0] || "").replace(/[^A-Z0-9]/g, "");
  const ext = (parts[1] || "").replace(/[^A-Z0-9]/g, "").slice(0, 3);

  const needsAlias =
    name.length > 8 ||
    /[^A-Z0-9]/.test(parts[0] || "") ||
    segment.includes("_") ||
    segment.includes(" ");

  let shortName = name.slice(0, 8);
  if (needsAlias && name.length > 0) {
    shortName = `${name.slice(0, 6)}~1`;
  }

  return ext ? `${shortName}.${ext}` : shortName;
}

function toDosAliasPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => toDosShortSegment(segment))
    .join("\\");
}

function scoreCandidate(path: string): { score: number; reason: string } {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = (parts[parts.length - 1] || "").toLowerCase();
  const ext = fileName.split(".").pop() || "";
  const depth = Math.max(0, parts.length - 1);

  let score = 0;
  const reasons: string[] = [];

  score += depth * 8;
  reasons.push(depth === 0 ? "root-level" : `nested depth ${depth}`);

  if (ext === "exe") {
    score += 0;
    reasons.push("exe");
  } else if (ext === "com") {
    score += 6;
    reasons.push("com");
  } else if (ext === "bat") {
    score += 20;
    reasons.push("bat");
  }

  if (/^(play|run|start|go)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 8;
    reasons.push("launcher-like");
  }

  if (/^(game|main)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 10;
    reasons.push("game-like");
  }

  if (/^(sierra|pq|sciv)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 12;
    reasons.push("title-like");
  }

  if (/^(install|setup|uninst|config|configure)\.(exe|com|bat)$/i.test(fileName)) {
    score += 260;
    reasons.push("installer/config");
  }

  if (/^autoexec\.bat$/i.test(fileName)) {
    score += 320;
    reasons.push("autoexec deprioritized");
  }

  if (/^(makepath|monitor|debug|test|patch|sound|mouse|keyb|keyboard|readme|manual|help|file_id|resource)\.(exe|com|bat)$/i.test(fileName)) {
    score += 220;
    reasons.push("likely utility/support");
  }

  if (/readme|manual|docs?|help|patch|mouse|sound|keyboard|monitor|makepath|resource/i.test(fileName)) {
    score += 120;
    reasons.push("support-ish name");
  }

  return {
    score,
    reason: reasons.join(", "),
  };
}

async function detectLaunchCandidates(file: File): Promise<LaunchCandidate[]> {
  const JSZip = (window as any).JSZip;
  if (!JSZip) {
    throw new Error("JSZip runtime not loaded.");
  }

  const zipData = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(zipData);

  const rawEntries = Object.keys(zip.files).filter(
    (name) => !(zip.files[name] as any).dir && /\.(exe|com|bat)$/i.test(name)
  );

  const normalizedEntries = stripCommonTopLevelFolder(rawEntries);

  const candidates = normalizedEntries.map((relativePath) => {
    const { score, reason } = scoreCandidate(relativePath);
    const displayPath = relativePath.replace(/\//g, "\\");
    const parts = relativePath.split("/").filter(Boolean);
    const fileName = parts[parts.length - 1] || relativePath;
    const relativeDir = parts.slice(0, -1).join("/");
    return {
      zipPath: relativePath,
      relativePath,
      displayPath,
      relativeDir,
      fileName,
      dosAliasDir: relativeDir ? toDosAliasPath(relativeDir) : "",
      dosAliasFile: toDosShortSegment(fileName),
      score,
      reason,
    };
  });

  candidates.sort((a, b) => a.score - b.score || a.displayPath.localeCompare(b.displayPath));
  return candidates;
}

function chooseAutoLaunchCandidate(candidates: LaunchCandidate[]): LaunchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const [first, second] = candidates;
  const confidentGap = second.score - first.score >= 25;
  const safeTop = first.score < 120;

  return safeTop && confidentGap ? first : null;
}

function mapUiKeyToDomKey(key: string) {
  const map: Record<string, string> = {
    ENTER: "Enter",
    ESC: "Escape",
    SPACE: " ",
    TAB: "Tab",
    ARROWUP: "ArrowUp",
    ARROWDOWN: "ArrowDown",
    ARROWLEFT: "ArrowLeft",
    ARROWRIGHT: "ArrowRight",
  };

  return map[key] || key;
}

function makeJsDosZipAdapter(viewport: HTMLDivElement | null): EmulatorAdapter {
  let hostEl: HTMLCanvasElement | null = null;
  let zipBlobUrl: string | null = null;

  const dispatchKey = (rawKey: string) => {
    if (!hostEl) return;

    const key = mapUiKeyToDomKey(rawKey);
    const eventInit: KeyboardEventInit = {
      key,
      bubbles: true,
      cancelable: true,
    };

    hostEl.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    hostEl.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    window.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    window.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  };

  return {
    async mountZip(file, options) {
      if (!viewport) return;
      if (typeof Dos !== "function") {
        throw new Error("js-dos runtime not loaded.");
      }

      viewport.innerHTML = "";

      const host = document.createElement("canvas");
      host.style.width = "100%";
      host.style.height = "100%";
      host.style.display = "block";
      host.width = 640;
      host.height = 480;
      host.tabIndex = 0;
      viewport.appendChild(host);
      hostEl = host;

      zipBlobUrl = URL.createObjectURL(file);

      const workingDir = options.dosSafeFolder;
      const launchDir = options.launchDir;
      const launchFile = options.launchFile;

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        try {
          const dosInstance = Dos(host, {
            wdosboxUrl: "https://js-dos.com/6.22/current/wdosbox.js",
          });

          if (!dosInstance || typeof dosInstance.ready !== "function") {
            reject(new Error("Unexpected js-dos API shape."));
            return;
          }

          dosInstance.ready((fs: any, main: any) => {
            try {
              fs.extract(zipBlobUrl, workingDir);

              const commands: string[] = ["-c", `cd ${workingDir}`];

              if (launchDir) {
                commands.push("-c", `cd ${launchDir}`);
              }

              commands.push("-c", launchFile);

              main(commands);
              settled = true;
              host.focus();
              resolve();
            } catch (error) {
              settled = true;
              reject(error);
            }
          });

          window.setTimeout(() => {
            if (!settled) {
              reject(new Error("Emulator startup timed out."));
            }
          }, 15000);
        } catch (error) {
          reject(error);
        }
      });
    },

    sendKey(key: string) {
      dispatchKey(key);
    },

    async saveState() {
      return "";
    },

    async loadState(_payload: string) {
      return;
    },

    async shutdown() {
      if (zipBlobUrl) {
        URL.revokeObjectURL(zipBlobUrl);
        zipBlobUrl = null;
      }
      if (viewport) {
        viewport.innerHTML = "";
      }
      hostEl = null;
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

export default function App() {
  const [loadedGame, setLoadedGame] = useState<LoadedGame | null>(null);
  const [status, setStatus] = useState("Choose a DOS game ZIP to start the emulator.");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [launchPickerOpen, setLaunchPickerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hiddenKeyboardRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  useEffect(() => {
    setSnapshots(readSnapshots());
  }, []);

  useEffect(() => {
    adapterRef.current = makeJsDosZipAdapter(viewportRef.current);
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

  async function launchCandidate(game: LoadedGame, candidate: LaunchCandidate) {
    setLoadedGame({
      ...game,
      selectedBootPath: `${game.dosSafeFolder}\\${candidate.dosAliasDir ? `${candidate.dosAliasDir}\\` : ""}${candidate.dosAliasFile}`,
    });
    setStatus(`Launching ${candidate.displayPath}...`);
    setLaunchPickerOpen(false);

    await adapterRef.current?.shutdown?.();
    await adapterRef.current?.mountZip(game.file, {
      dosSafeFolder: game.dosSafeFolder,
      launchDir: candidate.dosAliasDir,
      launchFile: candidate.dosAliasFile,
    });

    setStatus(
      `Loaded ${game.displayName}. ZIP name was normalized to the DOS-safe folder ${game.dosSafeFolder}.`
    );
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dosSafeFolder = getDosSafeFolderName(file.name);
      const launchCandidates = await detectLaunchCandidates(file);

      if (launchCandidates.length === 0) {
        throw new Error("No runnable EXE, COM, or BAT files found in ZIP.");
      }

      const nextLoadedGame: LoadedGame = {
        file,
        displayName: file.name,
        dosSafeFolder,
        launchCandidates,
        selectedBootPath: undefined,
      };

      setLoadedGame(nextLoadedGame);

      const autoCandidate = chooseAutoLaunchCandidate(launchCandidates);

      if (!autoCandidate) {
        setLaunchPickerOpen(true);
        setStatus("Multiple possible launch files found. Choose one to run.");
        await adapterRef.current?.shutdown?.();
        return;
      }

      await launchCandidate(nextLoadedGame, autoCandidate);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "The ZIP could not be mounted.");
    }
  }

  function sendKey(key: string) {
    adapterRef.current?.sendKey(key);
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleFileSelected}
          />
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
                  Launch details
                </div>
                <div className="text-xs text-slate-400">
                  Auto-detect first, then manual picker if the ZIP is ambiguous.
                </div>
                <div className="mt-3 rounded-2xl bg-slate-950 p-3 font-mono text-sm text-emerald-300">
                  {loadedGame.dosSafeFolder}
                </div>
                {loadedGame.selectedBootPath && (
                  <div className="mt-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 font-mono text-xs text-cyan-200">
                    Launching: {loadedGame.selectedBootPath}
                  </div>
                )}
              </div>
            )}

            {loadedGame && launchPickerOpen && (
              <div className="mt-3 rounded-3xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-3 text-sm font-semibold text-slate-100">
                  Choose a launch file
                </div>
                <div className="space-y-2">
                  {loadedGame.launchCandidates.slice(0, 20).map((candidate) => (
                    <button
                      key={candidate.relativePath}
                      onClick={() => launchCandidate(loadedGame, candidate)}
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-slate-100">
                          {candidate.displayPath}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {candidate.reason}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-200">
                        <Play size={14} />
                      </div>
                    </button>
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
                  <div
                    key={snapshot.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-slate-950 px-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-200">{snapshot.label}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(snapshot.createdAt).toLocaleString()}
                      </div>
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
          {keyboardMode ? (
            <div className="space-y-3 px-3">
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
                    <KeyButton
                      key={key}
                      label={key}
                      onPress={() => sendKey(key)}
                      className="min-w-[74px]"
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 px-3">
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
                    <KeyButton
                      key={key}
                      label={key}
                      onPress={() => sendKey(key)}
                      className="min-w-[74px]"
                    />
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
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
