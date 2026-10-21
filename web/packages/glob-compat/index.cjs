const { glob, globSync } = require("tinyglobby");

// Vinext's dynamic-import plugin uses only fast-glob.sync(patterns, { cwd }).
// Replace its unpatched braces dependency rather than suppressing the advisory.
function boundedPatterns(patterns) {
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    if (typeof pattern !== "string" || pattern.length > 65536) throw new TypeError("Unsupported glob pattern");
    const stack = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "\\") { i++; continue; }
      if (pattern[i] === "{" || pattern[i] === "(") {
        stack.push(pattern[i]);
        if (stack.length > 128) throw new RangeError("Glob nesting exceeds the supported limit");
      } else if (pattern[i] === "}" && stack.at(-1) === "{" || pattern[i] === ")" && stack.at(-1) === "(") stack.pop();
    }
  }
  return patterns;
}

function matchingFiles(patterns, options) {
  return glob(boundedPatterns(patterns), options);
}
matchingFiles.sync = (patterns, options) => globSync(boundedPatterns(patterns), options);
module.exports = matchingFiles;
