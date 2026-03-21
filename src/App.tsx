// @ts-ignore
declare const Dos: any;

import React, { useEffect, useMemo, useRef, useState } from "react";

type FileEntry = {
  original: string;
  normalized: string;
};

type EmulatorAdapter = {
  mountZip: (
    file: File,
    options: { dosSafeFolder: string; launchPath: string }
  ) => Promise<void>;
};

function normalizeDosToken(input: string) {
  return input
    .replace(/\.[^.]+$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "GAME";
}

function stripTopLevel(entries: string[]) {
  const split = entries.map((e) => e.split("/").filter(Boolean));
  const first = split[0]?.[0];

  if (!first) return entries;

  const shared = split.every((s) => s.length > 1 && s[0] === first);
  if (!shared) return entries;

  return split.map((s) => s.slice(1).join("/"));
}

function score(path: string) {
  const file = path.toLowerCase().split("/").pop() || "";

  if (file.endsWith(".exe")) return 0;
  if (file.endsWith(".com")) return 1;
  if (file.endsWith(".bat")) return 2;

  return 10;
}

async function analyzeZip(file: File): Promise<FileEntry[]> {
  const JSZip = (window as any).JSZip;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const entries = Object.keys(zip.files).filter(
    (k) => !zip.files[k].dir
  );

  const normalized = stripTopLevel(entries);

  return normalized
    .filter((p) => /\.(exe|com|bat)$/i.test(p))
    .map((p) => ({
      original: p,
      normalized: p,
    }))
    .sort((a, b) => score(a.normalized) - score(b.normalized));
}

function toDosPath(path: string) {
  return path
    .split("/")
    .map((seg) => {
      const name = seg.split(".")[0].replace(/[^A-Z0-9]/gi, "").toUpperCase();
      const ext = seg.split(".")[1]?.toUpperCase().slice(0, 3);

      if (name.length > 8) {
        return `${name.slice(0, 6)}~1${ext ? "." + ext : ""}`;
      }
      return ext ? `${name}.${ext}` : name;
    })
    .join("\\");
}

function makeAdapter(viewport: HTMLDivElement | null): EmulatorAdapter {
  return {
    async mountZip(file, options) {
      viewport!.innerHTML = "";

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      canvas.style.width = "100%";
      viewport!.appendChild(canvas);

      const blobUrl = URL.createObjectURL(file);

      const dos = Dos(canvas, {
        wdosboxUrl: "https://js-dos.com/6.22/current/wdosbox.js",
      });

      dos.ready((fs: any, main: any) => {
        fs.extract(blobUrl, options.dosSafeFolder);

        main([
          "-c",
          `cd ${options.dosSafeFolder}`,
          "-c",
          toDosPath(options.launchPath),
        ]);
      });
    },
  };
}

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Load a ZIP file");
  const [file, setFile] = useState<File | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  useEffect(() => {
    adapterRef.current = makeAdapter(viewportRef.current);
  }, []);

  async function handleFile(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setStatus("Analyzing ZIP...");

    const entries = await analyzeZip(f);
    setFiles(entries);

    if (entries.length === 1) {
      launch(entries[0].normalized, f);
    } else {
      setStatus("Select a file to launch");
    }
  }

  async function launch(path: string, f?: File) {
    const game = f || file;
    if (!game) return;

    const folder = normalizeDosToken(game.name);

    setSelected(path);
    setStatus(`Launching ${path}`);

    await adapterRef.current?.mountZip(game, {
      dosSafeFolder: folder,
      launchPath: path,
    });
  }

  return (
    <div style={{ padding: 16, color: "white", background: "#020617", height: "100vh" }}>
      <input type="file" accept=".zip" onChange={handleFile} />

      <div style={{ marginTop: 10 }}>{status}</div>

      {!selected && files.length > 1 && (
        <div style={{ marginTop: 10 }}>
          {files.map((f) => (
            <button
              key={f.original}
              onClick={() => launch(f.normalized)}
              style={{
                display: "block",
                marginBottom: 6,
                padding: 8,
                background: "#1e293b",
              }}
            >
              {f.normalized}
            </button>
          ))}
        </div>
      )}

      <div
        ref={viewportRef}
        style={{ marginTop: 16, width: "100%", aspectRatio: "4/3", background: "black" }}
      />
    </div>
  );
}
