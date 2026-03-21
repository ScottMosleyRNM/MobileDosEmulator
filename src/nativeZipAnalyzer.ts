// @ts-ignore
declare const emulators: any;

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

function chooseAutoLaunchCandidate(candidates: LaunchCandidate[]): LaunchCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const [first, second] = candidates;
  const confidentGap = second.score - first.score >= 
