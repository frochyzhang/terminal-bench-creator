/**
 * Pure JS lint service - zero dependencies.
 * Checks Terminal-Bench task files for quality issues.
 */

// A1: Banned words in instruction.md
const BANNED_WORDS = [
  'easy', 'simple', 'trivial', 'obvious', 'straightforward',
  'just', 'merely', 'only need to', 'all you need',
];

// A2: Instruction should start with a clear task description (not meta-text)
const BAD_STARTS = [
  'your task is', 'you need to', 'please', 'write a script',
  'create a script', 'in this task',
];

function checkA1BannedWords(instruction) {
  const lower = instruction.toLowerCase();
  const found = BANNED_WORDS.filter(w => lower.includes(w));
  return {
    id: 'A1',
    name: 'Banned Words',
    pass: found.length === 0,
    message: found.length === 0
      ? 'No banned words found'
      : `Found banned words: ${found.join(', ')}`,
  };
}

function checkA2Heading(instruction) {
  const firstLine = instruction.trim().split('\n')[0] || '';
  const lowerFirst = firstLine.toLowerCase();
  const badStart = BAD_STARTS.find(s => lowerFirst.includes(s));
  return {
    id: 'A2',
    name: 'Instruction Style',
    pass: !badStart,
    message: badStart
      ? `Instruction starts with discouraged phrase: "${badStart}"`
      : 'Instruction heading is fine',
  };
}

function checkA3Paths(instruction, solve) {
  // Check that paths in instruction match paths actually used in solve
  const pathRegex = /\/[a-zA-Z0-9_\-./]+/g;
  const instructionPaths = instruction.match(pathRegex) || [];
  const solvePaths = solve.match(pathRegex) || [];

  // Simple check: if instruction mentions /solution/, solve should too
  const mentionsSolution = instructionPaths.some(p => p.includes('/solution/'));
  const solveUsesSolution = solvePaths.some(p => p.includes('/solution/'));

  const issues = [];
  if (mentionsSolution && !solveUsesSolution) {
    issues.push('Instruction mentions /solution/ paths but solve.sh does not use them');
  }

  return {
    id: 'A3',
    name: 'Path Accuracy',
    pass: issues.length === 0,
    message: issues.length === 0
      ? 'Paths appear consistent'
      : issues.join('; '),
  };
}

function checkA5English(instruction) {
  // Basic check for non-ASCII characters that might indicate non-English text
  // Allow common technical characters
  const nonAscii = instruction.match(/[^\x00-\x7F]/g) || [];
  const nonAsciiCount = nonAscii.length;
  const pass = nonAsciiCount < 5;
  return {
    id: 'A5',
    name: 'English Purity',
    pass,
    message: pass
      ? 'Content appears to be in English'
      : `Found ${nonAsciiCount} non-ASCII characters (possible non-English text)`,
  };
}

function checkDockerfileNoTestDeps(dockerfile) {
  // Dockerfile should not install test-specific tools like pytest, mocha, etc.
  const testPatterns = ['pytest', 'mocha', 'jest ', 'junit', 'bats', 'shunit'];
  const lower = dockerfile.toLowerCase();
  const found = testPatterns.filter(p => lower.includes(p));
  return {
    id: 'D1',
    name: 'Dockerfile No Test Deps',
    pass: found.length === 0,
    message: found.length === 0
      ? 'Dockerfile does not install test-only dependencies'
      : `Dockerfile appears to install test dependencies: ${found.join(', ')}`,
  };
}

function checkDockerfileNoCopySolution(dockerfile) {
  const hasCopySolution = /COPY\s+solution[/\s]/i.test(dockerfile);
  return {
    id: 'D2',
    name: 'Dockerfile No COPY solution/',
    pass: !hasCopySolution,
    message: hasCopySolution
      ? 'Dockerfile must not COPY solution/ directory'
      : 'Dockerfile does not copy solution/',
  };
}

function checkSolveNotHardcoded(solve) {
  // Solve should not just copy files from a hardcoded location
  const hardcodedPatterns = [
    /cp\s+\/[^\s]+\/answer/i,
    /cp\s+-r\s+\/[^\s]+\/solution/i,
    /ln\s+-s\s+\/[^\s]+\/solution/i,
  ];
  const found = hardcodedPatterns.filter(r => r.test(solve));
  return {
    id: 'S1',
    name: 'Solve Not Hardcoded',
    pass: found.length === 0,
    message: found.length === 0
      ? 'solve.sh does not appear to hardcode solution paths'
      : 'solve.sh may be hardcoding solution file copies',
  };
}

function checkTestNoDockerfileDep(test, dockerfile) {
  // test.sh should not reference tools only present in Dockerfile (anti-cheat)
  // Simple heuristic: if test uses docker commands, flag it
  const hasDocketCmd = /\bdocker\b/.test(test);
  return {
    id: 'T1',
    name: 'Test No Docker Dependency',
    pass: !hasDocketCmd,
    message: hasDocketCmd
      ? 'test.sh should not call docker directly'
      : 'test.sh does not use docker commands',
  };
}

function checkTomlRequired(toml) {
  const required = ['name', 'description', 'category', 'difficulty'];
  const missing = required.filter(k => !toml.includes(k));
  return {
    id: 'TM1',
    name: 'TOML Required Fields',
    pass: missing.length === 0,
    message: missing.length === 0
      ? 'task.toml has all required fields'
      : `task.toml missing fields: ${missing.join(', ')}`,
  };
}

function checkTomlTimeouts(toml) {
  const hasAgentTimeout = /agent\s*=\s*\d+/.test(toml);
  const hasEvalTimeout = /eval\s*=\s*\d+/.test(toml);
  return {
    id: 'TM2',
    name: 'TOML Timeouts',
    pass: hasAgentTimeout && hasEvalTimeout,
    message: hasAgentTimeout && hasEvalTimeout
      ? 'task.toml has agent and eval timeouts'
      : 'task.toml missing timeout.agent or timeout.eval',
  };
}

function checkShebang(filename, content) {
  const hasShebang = content.trim().startsWith('#!/');
  return {
    id: `SH_${filename.toUpperCase().replace(/\./g, '_')}`,
    name: `Shebang in ${filename}`,
    pass: hasShebang,
    message: hasShebang
      ? `${filename} has a shebang line`
      : `${filename} is missing a shebang line`,
  };
}

export function lintTask(files) {
  const {
    'instruction.md': instruction = '',
    'task.toml': toml = '',
    'solution/solve.sh': solve = '',
    'tests/test.sh': test = '',
    'environment/Dockerfile': dockerfile = '',
  } = files;

  const checks = [
    checkA1BannedWords(instruction),
    checkA2Heading(instruction),
    checkA3Paths(instruction, solve),
    checkA5English(instruction),
    checkDockerfileNoTestDeps(dockerfile),
    checkDockerfileNoCopySolution(dockerfile),
    checkSolveNotHardcoded(solve),
    checkTestNoDockerfileDep(test, dockerfile),
    checkTomlRequired(toml),
    checkTomlTimeouts(toml),
    checkShebang('solve.sh', solve),
  ];

  const passed = checks.filter(c => c.pass).length;
  const total = checks.length;

  return {
    passed,
    total,
    score: `${passed}/${total}`,
    ready: passed === total,
    checks,
  };
}
