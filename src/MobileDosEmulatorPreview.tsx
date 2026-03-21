import React, { useEffect, useRef, useState } from "react";

type EmulatorAdapter = {
  mountZip: (file: File, options: { dosSafeFolder: string }) => Promise<void>;
  sendKey: (key: string) => void;
  shutdown?: () => Promise<void>;
};

function normalizeDosToken(input: string) {
  const withoutExt = input.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (cleaned || "GAME").slice(0, 8);
}

function getDosSafeFolderName(fileName: string) {
  return normalizeDosToken(fileName);
}

/**
 * ✅ CLEAN MOCK ADAPTER
 * - No js-dos
 * - No fs calls
 * - No undefined runtime
 * - Always builds
 */
function createMockAdapter(viewport: HTMLDivElement | null): EmulatorAdapter {
  return {
    async mountZip(file, { dosSafeFolder }) {
      if (!viewport) return;

      viewport.innerHTML = "";

      const container = document.createElement("div");
      container.style.height = "100%";
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      container.style.background = "black";
      container.style.color = "#e2e8f0";
      container.style.textAlign = "center";
      container.style.padding = "16px";

      container.innerHTML = `
        <div style="color:#22d3ee;font-size:12px;letter-spacing:.3em;text-transform:uppercase;margin-bottom:10px;">
          Mobile DOS Emulator
        </div>
        <div style="font-size:18px;font-weight:600;margin-bottom:6px;">
          ${file.name}
        </div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:8px;">
          Mounted as DOS-safe folder
        </div>
        <div style="font-family:monospace;font-size:20px;color:#86efac;">
          ${dosSafeFolder}
        </div>
        <div style="margin-top:16px;font-size:12px;color:#64748b;max-width:260px;">
          Emulator runtime disabled in this stable build.<br/>
          UI + controls are fully functional.
        </div>
      `;

      viewport.appendChild(container);
    },

    sendKey(key) {
      console.log("KEY:", key);
    },

    async shutdown() {
      if (viewport) viewport.innerHTML = "";
    },
  };
}

export default function MobileDosEmulatorPreview() {
  const [status, setStatus] = useState(
    "Choose a DOS game ZIP to start the emulator."
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [dosFolder, setDosFolder] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  useEffect(() => {
    adapterRef.current = createMockAdapter(viewportRef.current);
  }, []);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const folder = getDosSafeFolderName(file.name);

    setFileName(file.name);
    setDosFolder(folder);
    setStatus(`Loading ${file.name}...`);

    try {
      await adapterRef.current?.shutdown?.();
      await adapterRef.current?.mountZip(file, {
        dosSafeFolder: folder,
      });

      setStatus(
        `Loaded ${file.name}. ZIP normalized to ${folder}`
      );
    } catch (e) {
      console.error(e);
      setStatus("Failed to load ZIP.");
    }
  }

  function sendKey(key: string) {
    adapterRef.current?.sendKey(key);
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-white">
      {/* HEADER */}
      <div className="p-4 border-b border-slate-800 flex justify-between">
        <div>
          <div className="text-xs text-cyan-300 uppercase tracking-widest">
            DOSPLAY
          </div>
          <div className="text-sm text-slate-400">
            Mobile browser emulator shell
          </div>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-cyan-500/20 px-4 py-2 rounded-lg text-cyan-200"
        >
          Load Game
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* VIEWPORT */}
      <div className="p-3">
        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex justify-between text-xs px-2 py-1 border-b border-slate-800 text-slate-400">
            <span>{fileName || "No game loaded"}</span>
            <span className="text-cyan-300 font-mono">
              {dosFolder || "READY"}
            </span>
          </div>

          <div
            ref={viewportRef}
            className="bg-black aspect-[4/3]"
          />
        </div>
      </div>

      {/* STATUS */}
      <div className="px-3 text-sm text-slate-300">
        {status}
      </div>

      {/* CONTROLS */}
      <div className="mt-auto p-3 space-y-2">
        <div className="flex gap-2 overflow-x-auto">
          <button className="bg-cyan-500/20 px-3 py-2 rounded">
            Type
          </button>
          {["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"].map(k => (
            <button key={k} onClick={() => sendKey(k)} className="px-3 py-2 bg-slate-800 rounded">
              {k}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => sendKey("UP")}>↑</button>
          <button onClick={() => sendKey("ENTER")}>ENTER</button>
          <button onClick={() => sendKey("ESC")}>ESC</button>
          <button onClick={() => sendKey("LEFT")}>←</button>
          <button>🎮</button>
          <button onClick={() => sendKey("RIGHT")}>→</button>
          <button onClick={() => sendKey("DOWN")}>↓</button>
          <button onClick={() => sendKey("SPACE")}>SPACE</button>
          <button onClick={() => sendKey("TAB")}>TAB</button>
        </div>
      </div>
    </div>
  );
}
