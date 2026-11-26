const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "UNVORLauncher", "app", "src", "main");
const java = fs.readFileSync(path.join(root, "java/com/ultron/launcher/MainActivity.java"), "utf8");
const js = fs.readFileSync(path.join(root, "assets/hud/home.js"), "utf8");

assert.match(java, /private final ExecutorService appsIo = Executors\.newSingleThreadExecutor\(\)/);
assert.match(java, /private final ExecutorService launchIo = Executors\.newSingleThreadExecutor\(\)/);
assert.match(java, /private volatile Set<String> knownLaunchTargets/);
assert.match(java, /private volatile JSONArray cachedApps/);
assert.match(java, /JSONArray cached=cachedApps;[\s\S]*?emit\("apps",cached\);return/);
assert.match(java, /knownLaunchTargets=Collections\.unmodifiableSet\(targets\);\s*cachedApps=quickRows/);
assert.match(java, /emit\("apps",quickRows\);[\s\S]*?cachedApps=iconRows;[\s\S]*?emit\("apps",iconRows\)/);
const fast = java.indexOf("if(knownLaunchTargets.contains(launchTarget(pkg,activity)))");
const slow = java.indexOf("launchIo.execute", fast);
assert.ok(fast > 0 && slow > fast, "The cached instant path must be reached before fallback discovery");
assert.ok(java.slice(fast, slow).includes("launchVerified("), "The cached target must immediately launch");
assert.ok(!java.slice(fast, slow).includes("launchable()"), "The cached target must not enumerate packages");
assert.match(java, /appsIo\.shutdownNow\(\);launchIo\.shutdownNow\(\)/);
assert.match(js, /const previousQuery=before\?\.value\|\|''/);
assert.match(js, /input\.value=previousQuery/);
assert.match(js, /if\(hadFocus\)input\.focus\(\)/);
console.log("UNVOR Launcher: fast launch, independent app icon work, cache and preserved search OK");
