import { readFileSync } from "node:fs";

const [kind, filename] = process.argv.slice(2);
const report = JSON.parse(readFileSync(filename, "utf8"));

if (kind === "audit") {
  const advisory = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
  const findings = report.vulnerabilities;
  if (report.error || report.auditReportVersion !== 2 || !findings
      || Object.keys(findings).length !== report.metadata?.vulnerabilities?.total) {
    throw new Error("Incomplete npm audit report.");
  }
  // The current advisory has no fixed npm release. The pilot build consumes
  // repository-controlled globs; the shipped bundle is checked independently.
  const entries = Object.entries(findings);
  for (const [name, finding] of entries) {
    if (!finding.via?.length || !finding.via.every(cause => typeof cause === "string"
      ? Object.hasOwn(findings, cause)
      : name === "picomatch" && cause?.name === "picomatch" && cause.url === advisory)) {
      throw new Error("npm audit blocked the pilot: " + name);
    }
  }
  const related = new Set();
  if (findings.picomatch?.via.some(cause => cause?.url === advisory)) related.add("picomatch");
  // Several Metro packages refer back to each other in npm's audit graph.
  let previousSize;
  do {
    previousSize = related.size;
    for (const [name, finding] of entries) {
      if (finding.via.some(cause => related.has(cause))) related.add(name);
    }
  } while (related.size !== previousSize);
  if (related.size !== entries.length) throw new Error("npm audit has unexplained findings.");
  if (Object.keys(findings).length) {
    console.log("Pilot build tooling exception: GHSA-fc5q-39xc-vjpf. Picomatch is forbidden in the APK bundle.");
  }
} else if (kind === "bundle") {
  function sourcesOf(map) {
    if (Array.isArray(map.sources)) return map.sources;
    if (Array.isArray(map.sections)) return map.sections.flatMap(section => sourcesOf(section.map));
    throw new Error("Unexpected Android source map format.");
  }
  const sources = sourcesOf(report);
  if (!sources.some(source => /(?:^|[\\/])src[\\/]screens[\\/]SignupScreen\.js$/.test(source))) {
    throw new Error("The source map does not identify the pilot signup bundle.");
  }
  if (sources.some(source => /(?:^|[\\/])picomatch(?:[\\/]|$)/.test(source))) {
    throw new Error("Picomatch must not be included in the Android runtime package.");
  }
  console.log("Android runtime bundle contains no Picomatch sources.");
} else {
  throw new Error("Pass audit or bundle and the matching JSON path.");
}
