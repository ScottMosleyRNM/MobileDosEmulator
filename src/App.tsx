// @ts-ignore
declare const Dos: any;

import React, { useEffect, useRef, useState } from "react";

type Candidate = {
  fullPath: string;
  dir: string;
  file: string;
};

function normalizeDosToken(input: string) {
  return input
    .replace(/\.[^.]+$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "GAME";
}

function toDosSegment(seg: string) {
  const [nameRaw, extRaw] = seg.split(".");
  const name = nameRaw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const ext = extRaw?.toUpperCase().slice(0, 3);

  if (name.length > 8) {
    return `${name.slice(0, 6)}~1${ext ? "." + ext : ""}`;
  }
  return ext ? `${name}.${ext}` : name;
}

function toDosPath(path: string) {
  return path.split("/").map(toDosSegment).join("\\");
}

function splitPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return {
    dir: parts.slice(0, -1).join("/"),
    file: parts[parts.length - 1],
  };
}

function stripTopFolder(entries: string[]) {
  const split = entries.map((e) => e.split("/").filter(Boolean));
  const root = split[0]?.[0];

  if (!root) return entries;

  const shared = split.every((s) => s.length > 1 && s[0] === root);
  if (!shared) return entries;

  return split.map((s) => s.slice(1).join("/"));
}

async function analyzeZip(file: File): Promise<Candidate[]> {
  const JSZip = (window as any).JSZip;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  let entries = Object.keys(zip.files).filter(
    (k) => !zip.files[k].dir
  );

  entries = stripTopFolder(entries);

  return entries
    .filter((e) => /\.(exe|com|bat)$/i.test(e))
    .map((e) => {
      const { dir, file } = splitPath(e);
      return { fullPath: e, dir, file };
    });
}

function makeAdapter(viewport: HTMLDivElement | null) {
  return {
    async mount(file: File, folder: string, candidate: Candidate) {
      viewport!.innerHTML = "";

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      canvas.style.width = "100%";
      viewport!.appendChild(canvas);

      const blob = URL.createObjectURL(file);

      const dos = Dos(canvas, {
        wdosboxUrl: "https://js-dos.com/6.22/current/wdosbox.js",
      });

      dos.ready((fs: any, main: any) => {
        fs.extract(blob, folder);

        const commands = [
          "-c",
          `cd ${folder}`,
        ];

        if (candidate.dir) {
          commands.push("-c", `cd ${toDosPath(candidate.dir)}`);
        }

        commands.push("-c", toDosSegment(candidate.file));

        main(commands);
      });
    },
  };
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState("Load a DOS ZIP");

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<any>(null);

  useEffect(() => {
    adapterRef.current = makeAdapter(viewportRef.current);
  }, []);

  async function handleFile(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setStatus("Analyzing ZIP...");

    const list = await analyzeZip(f);
    setCandidates(list);

    if (list.length === 1) {
      launch(list[0], f);
    } else {
      setStatus("Choose a file to launch");
    }
  }

  async function launch(candidate: Candidate, f?: File) {
    const game = f || file;
    if (!game) return;

    const folder = normalizeDosToken(game.name);

    setStatus(`Launching ${candidate.file}`);

    await adapterRef.current.mount(game, folder, candidate);
  }

  return (
    <div style={{ height: "100vh", background: "#020617", color: "white", display: "flex", flexDirection: "column" }}>
      
      {/* HEADER */}
      <div style={{ padding: 12 }}>
        <input type="file" accept=".zip" onChange={handleFile} />
        <div>{status}</div>
      </div>

      {/* VIEWPORT */}
      <div
        ref={viewportRef}
        style={{
          width: "100%",
          aspectRatio: "4/3",
          background: "black",
        }}
      />

      {/* LAUNCH PICKER */}
      {candidates.length > 1 && (
        <div style={{ padding: 12, overflowY: "auto" }}>
          {candidates.map((c) => (
            <button
              key={c.fullPath}
              onClick={() => launch(c)}
              style={{
                display: "block",
                width: "100%",
                marginBottom: 6,
                padding: 10,
                background: "#1e293b",
                borderRadius: 8,
              }}
            >
              {c.fullPath}
            </button>
          ))}
        </div>
      )}

      {/* CONTROLS */}
      <div style={{
        marginTop: "auto",
        padding: 12,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8
      }}>
        <button>↑</button>
        <button>Enter</button>
        <button>Esc</button>
        <button>←</button>
        <button>↓</button>
        <button>→</button>
      </div>
    </div>
  );
}
