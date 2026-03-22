export type LaunchCandidate = {
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

export type LaunchAnalysis = {
  candidates: LaunchCandidate[];
  autoLaunch: LaunchCandidate | null;
};

type ParsedZipEntry = {
  path: string;
  isDirectory: boolean;
};

const EOCD_SIGNATURE = 0x06054b50;
const CDFH_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 0xffff + 22;

const CP437_TABLE = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index));
[
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba,
  0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
  0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b,
  0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
  0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
].forEach((codePoint, offset) => {
  CP437_TABLE[0x80 + offset] = String.fromCodePoint(codePoint);
});

function stripCommonTopLevelFolder(paths: string[]) {
  const splitPaths = paths.map((p) => p.split("/").filter(Boolean));
  if (splitPaths.length === 0) return paths;

  const firstSegment = splitPaths[0][0];
  if (!firstSegment) return paths;

  const allShareFirst = splitPaths.every((parts) => parts.length > 1 && parts[0] === firstSegment);
  if (!allShareFirst) return paths;

  return splitPaths.map((parts) => parts.slice(1).join("/"));
}

function normalizeDosToken(input: string) {
  const withoutExt = input.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (cleaned || "GAME").slice(0, 8);
}

export function getDosSafeFolderName(fileName: string) {
  return normalizeDosToken(fileName);
}

function toDosShortSegment(segment: string) {
  const upper = segment.toUpperCase();
  const lastDot = upper.lastIndexOf(".");
  const rawName = lastDot >= 0 ? upper.slice(0, lastDot) : upper;
  const rawExt = lastDot >= 0 ? upper.slice(lastDot + 1) : "";

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

function toDosAliasPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => toDosShortSegment(segment))
    .join("\\");
}

function decodeCp437(bytes: Uint8Array) {
  let result = "";
  for (const value of bytes) result += CP437_TABLE[value] ?? "?";
  return result;
}

function decodeZipString(bytes: Uint8Array, flags: number) {
  if ((flags & 0x800) !== 0) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  return decodeCp437(bytes);
}

function findEndOfCentralDirectory(view: DataView) {
  const lowerBound = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);

  for (let offset = view.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;

    return {
      entryCount: view.getUint16(offset + 10, true),
      centralDirectorySize: view.getUint32(offset + 12, true),
      centralDirectoryOffset: view.getUint32(offset + 16, true),
    };
  }

  throw new Error("Could not find ZIP central directory.");
}

function parseZipEntries(buffer: ArrayBuffer): ParsedZipEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEndOfCentralDirectory(view);

  const entries: ParsedZipEntry[] = [];
  let cursor = eocd.centralDirectoryOffset;
  const end = eocd.centralDirectoryOffset + eocd.centralDirectorySize;

  while (cursor < end && entries.length < eocd.entryCount) {
    if (view.getUint32(cursor, true) !== CDFH_SIGNATURE) {
      throw new Error("ZIP central directory entry signature mismatch.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);

    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    const path = decodeZipString(bytes.slice(fileNameStart, fileNameEnd), flags).replace(/\\/g, "/");

    entries.push({
      path,
      isDirectory: path.endsWith("/"),
    });

    cursor = fileNameEnd + extraLength + commentLength;
  }

  return entries;
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
    reasons.push("exe");
  } else if (ext === "com") {
    score += 8;
    reasons.push("com");
  } else if (ext === "bat") {
    score += 22;
    reasons.push("bat");
  }

  if (/^(play|run|start|go|launch)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 16;
    reasons.push("launcher-like");
  }

  if (/^(game|main)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 14;
    reasons.push("game-like");
  }

  if (/^(sierra|sciv|scivw|pq|kq|sq|lsl|keen|doom|wolf3d|duke3d)\.(exe|com|bat)$/i.test(fileName)) {
    score -= 24;
    reasons.push("title-like");
  }

  if (/^(install|setup|uninst|config|configure|install3|setup3)\.(exe|com|bat)$/i.test(fileName)) {
    score += 280;
    reasons.push("installer/config");
  }

  if (/^autoexec\.bat$/i.test(fileName)) {
    score += 340;
    reasons.push("autoexec deprioritized");
  }

  if (/^(makepath|monitor|debug|test|patch|sound|sndsetup|mouse|keyb|keyboard|readme|manual|help|file_id|resource)\.(exe|com|bat)$/i.test(fileName)) {
    score += 240;
    reasons.push("likely utility/support");
  }

  if (/readme|manual|docs?|help|patch|mouse|sound|sndsetup|keyboard|monitor|makepath|resource/i.test(fileName)) {
    score += 140;
    reasons.push("support-ish name");
  }

  return {
    score,
    reason: reasons.join(", "),
  };
}

function chooseAutoLaunchCandidate(candidates: LaunchCandidate[]): LaunchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const nonSetup = candidates.filter(
    (c) =>
      !/installer\/config|autoexec deprioritized|likely utility\/support|support-ish name/i.test(c.reason)
  );

  if (nonSetup.length === 1) {
    return nonSetup[0];
  }

  const [first, second] = candidates;
  if (!second) return first;

  const confidentGap = second.score - first.score >= 35;
  const safeTop = first.score < 100;

  return safeTop && confidentGap ? first : null;
}

export async function analyzeZipNatively(file: File): Promise<LaunchAnalysis> {
  const buffer = await file.arrayBuffer();

  const entryPaths = parseZipEntries(buffer)
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.path)
    .filter((path) => /\.(exe|com|bat)$/i.test(path));

  if (entryPaths.length === 0) {
    throw new Error("No runnable EXE, COM, or BAT files found in ZIP.");
  }

  const normalizedEntries = stripCommonTopLevelFolder(entryPaths);

  const candidates = normalizedEntries
    .map((relativePath) => {
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
    })
    .sort((a, b) => a.score - b.score || a.displayPath.localeCompare(b.displayPath));

  return {
    candidates,
    autoLaunch: chooseAutoLaunchCandidate(candidates),
  };
}
