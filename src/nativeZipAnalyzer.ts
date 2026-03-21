// @ts-ignore
declare const emulators: any;

export type LaunchCandidate = {
  relativePath: string;
  relativeDir: string;
  fileName: string;
  displayPath: string;
  dosAliasDir: string;
  dosAliasFile: string;
  score: number;
  reason: string[];
};

export type LaunchAnalysis = {
  candidates: LaunchCandidate[];
  autoLaunch: LaunchCandidate | null;
};

function toDosShortSegment(segment: string) {
  const upper = segment.toUpperCase();
  const parts = upper.split(".");
  const rawName = parts[0] || "";
  const rawExt = parts[1] || "";

  const name = rawName.replace(/[^A-Z0-9]/g, "");
  const ext = rawExt.replace(/[^A-Z0-9]/g, "").slice(0, 3);

  const needsAlias =
    name.length > 8 ||
    /[^A-Z0-9]/.test(rawName) ||
    rawName.includes("_") ||
    rawName.includes(" ");

  let shortName = name.slice(0, 8);
  if (needsAlias && name.length > 0) {
    shortName = `${name.slice(0, 6)}~1`;
  }

  return ext ? `${shortName}.${ext}` : shortName;
}

export function toDosAliasPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => toDosShortSegment(segment))
    .join("\\");
}

function scoreCandidate(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = (parts[parts.length - 1] || "").toLowerCase();
  const ext = fileName.split(".").pop() || "";
  const depth = Math.max(0, parts.length - 1);

  let score = 0;
  const reason: string[] = [];

  score += depth * 10;
  reason.push(depth === 0 ? "root-level" : `nested depth ${depth}`);

  if (ext === "exe") {
    score += 0;
    reason.push("exe");
  } else if (ext === "com") {
    score += 6;
    reason.push("com");
  } else if (ext === "bat") {
    score += 18;
    reason.push("bat");
  }

  if (/^(play|run|go|launch)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 15;
    reason.push("common launcher");
  }

  if (/^start\.bat$/i.test(fileName)) {
    score -= 10;
    reason.push("start bat");
  }

  if (/^(game|main)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 14;
    reason.push("generic game binary");
  }

  if (/^(install|setup|config|configure|uninst)\.(exe|com|bat)$/i.test(fileName)) {
    score += 250;
    reason.push("installer/config");
  }

  if (/^autoexec\.bat$/i.test(fileName)) {
    score += 300;
    reason.push("autoexec deprioritized");
  }

  if (/^(monitor|makepath|mouse|sound|sndsetup|keyboard|keyb|debug|patch|resource)\.(exe|com|bat)$/i.test(fileName)) {
    score += 180;
    reason.push("utility/support executable");
  }

  if (/readme|manual|docs?|help|monitor|makepath|resource|setup|install|config/i.test(fileName)) {
    score += 100;
    reason.push("support-ish name");
  }

  return { score, reason };
}

function chooseAutoLaunch(candidates: LaunchCandidate[]) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const [first, second] = candidates;
  const strongTop = first.score < 80;
  const strongGap = second.score - first.score >= 25;

  return strongTop && strongGap ? first : null;
}

function walkFs(FS: any, rootPath: string, basePath = rootPath): string[] {
  const out: string[] = [];
  const entries = FS.readdir(rootPath).filter((name: string) => name !== "." && name !== "..");

  for (const name of entries) {
    const full = `${rootPath}/${name}`.replace(/\/+/g, "/");
    const stat = FS.stat(full);

    if (FS.isDir(stat.mode)) {
      out.push(...walkFs(FS, full, basePath));
      continue;
    }

    if (/\.(exe|com|bat)$/i.test(name)) {
      const relative = full.slice(basePath.length).replace(/^\/+/, "");
      out.push(relative);
    }
  }

  return out;
}

export async function analyzeZipNatively(file: File): Promise<LaunchAnalysis> {
  if (!emulators?.bundle) {
    throw new Error("emulators.bundle() is not available.");
  }

  const zipBytes = new Uint8Array(await file.arrayBuffer());
  const bundle = await emulators.bundle();

  const mountPath = `/scan-${Date.now()}`;

  try {
    await bundle.zipToFs(zipBytes, mountPath);

    const FS = bundle.module.FS;
    const scanRoot = `/home/web_user${mountPath}`;
    const files = walkFs(FS, scanRoot, scanRoot);

    if (files.length === 0) {
      throw new Error("No runnable EXE, COM, or BAT files found in ZIP.");
    }

    const candidates = files
      .map((relativePath) => {
        const normalized = relativePath.replace(/\\/g, "/");
        const parts = normalized.split("/").filter(Boolean);
        const fileName = parts[parts.length - 1] || normalized;
        const relativeDir = parts.slice(0, -1).join("/");

        const { score, reason } = scoreCandidate(normalized);

        return {
          relativePath: normalized,
          relativeDir,
          fileName,
          displayPath: normalized.replace(/\//g, "\\"),
          dosAliasDir: relativeDir ? toDosAliasPath(relativeDir) : "",
          dosAliasFile: toDosShortSegment(fileName),
          score,
          reason,
        };
      })
      .sort((a, b) => a.score - b.score || a.displayPath.localeCompare(b.displayPath));

    return {
      candidates,
      autoLaunch: chooseAutoLaunch(candidates),
    };
  } finally {
    try {
      bundle.destroy?.();
    } catch {}
  }
}
