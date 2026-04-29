// JUnit XML report rendering for the TypeScript runner.

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderJUnit(suiteName, results) {
  const total = results.length;
  const failures = results.filter((r) => !r.outcome.ok).length;
  const totalTimeMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    `<testsuite name="${xmlEscape(suiteName)}" tests="${total}" failures="${failures}" errors="0" time="${(totalTimeMs / 1000).toFixed(3)}">`
  );
  for (const r of results) {
    const classname = `${r.category}.${r.fileName}`;
    const attrs = `classname="${xmlEscape(classname)}" name="${xmlEscape(r.vectorName)}" time="${(r.durationMs / 1000).toFixed(3)}"`;
    if (r.outcome.ok) {
      parts.push(`  <testcase ${attrs}/>`);
    } else {
      parts.push(`  <testcase ${attrs}>`);
      parts.push(`    <failure message="${xmlEscape(r.outcome.message)}"></failure>`);
      parts.push(`  </testcase>`);
    }
  }
  parts.push('</testsuite>');
  return parts.join('\n') + '\n';
}
