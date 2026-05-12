// io-utils.mjs — thin re-export from the canonical yielde-bridge helper.
//
// Phase 7 (Yielde Bridge) consolidated Node-side parseFrontmatter / stripBom /
// JSON readers / manifest runtime extraction into one module. yielde-skills
// CLIs (build-index, import-hermes, run-evals, operator-bridge-dispatch) share
// the same impl by re-exporting from the sibling repo at
//   ../../yielde-bridge/lib/io-utils.mjs
//
// This assumes yielde-skills and yielde-bridge are checked out as siblings
// under the same parent directory (Chris's machine: C:\Users\chris\yielde-*).
// A standalone clone of yielde-skills without yielde-bridge present will
// surface a clear `Cannot find module` ImportError when these scripts run —
// that's intentional: scripts/ here is internal curator tooling, not part of
// the public skill library that consumers ship.
//
// If/when yielde-skills tooling needs to run without the sibling, publish the
// helper as an npm package or vendor it back here. For now, re-export is the
// simplest single-source-of-truth.

export {
  stripBom,
  readJsonOrDefault,
  readJsonStrict,
  readJsonOrDefaultSync,
  parseFrontmatter,
  readManifestRuntime,
  stripLibuvNoise,
} from "../../yielde-bridge/lib/io-utils.mjs";
