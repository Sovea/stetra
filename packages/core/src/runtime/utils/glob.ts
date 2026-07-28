/**
 * Lightweight glob matcher for the subset used by playbook scopes and RCCL scopes.
 */
export function minimatch(filepath: string, pattern: string): boolean {
  return globToRegex(pattern).test(filepath.replace(/\\/g, '/'));
}

/**
 * Returns whether the supported glob language contains any path below a
 * literal repository-relative root. This is a reachability check over the same
 * glob grammar as `minimatch`, not a generated-path sample.
 */
export function globCanMatchDescendant(pattern: string, root: string): boolean {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedRoot || hasGlobSyntax(normalizedRoot)) return false;
  const automaton = buildGlobAutomaton(pattern.replace(/\\/g, '/'));
  let states = epsilonClosure(automaton, new Set([automaton.start]));
  for (const character of `${normalizedRoot}/`) {
    const next = new Set<number>();
    for (const state of states) {
      for (const edge of automaton.edges[state]) {
        if (edge.matches?.(character)) next.add(edge.to);
      }
    }
    states = epsilonClosure(automaton, next);
    if (!states.size) return false;
  }
  const canReachAccept = reverseReachableStates(automaton);
  return [...states].some((state) => canReachAccept.has(state));
}

interface GlobEdge {
  to: number;
  matches?: (character: string) => boolean;
}

interface GlobAutomaton {
  start: number;
  accept: number;
  edges: GlobEdge[][];
}

function buildGlobAutomaton(pattern: string): GlobAutomaton {
  const edges: GlobEdge[][] = [[]];
  const createState = (): number => {
    edges.push([]);
    return edges.length - 1;
  };
  const addEdge = (from: number, edge: GlobEdge): void => {
    edges[from].push(edge);
  };
  let current = 0;
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        const consumed = createState();
        const next = createState();
        addEdge(current, { to: next });
        addEdge(current, { to: consumed, matches: () => true });
        addEdge(consumed, { to: consumed, matches: () => true });
        addEdge(consumed, { to: next, matches: (value) => value === '/' });
        current = next;
        index += 3;
        continue;
      }
      const next = createState();
      addEdge(current, { to: next });
      addEdge(current, { to: current, matches: () => true });
      current = next;
      index += 2;
      continue;
    }
    if (character === '*') {
      const next = createState();
      addEdge(current, { to: next });
      addEdge(current, { to: current, matches: (value) => value !== '/' });
      current = next;
      index += 1;
      continue;
    }
    if (character === '?') {
      const next = createState();
      addEdge(current, { to: next, matches: (value) => value !== '/' });
      current = next;
      index += 1;
      continue;
    }
    if (character === '{') {
      const closeIndex = pattern.indexOf('}', index + 1);
      if (closeIndex !== -1) {
        const options = pattern
          .slice(index + 1, closeIndex)
          .split(',')
          .map((option) => option.trim())
          .filter(Boolean);
        if (options.length) {
          const next = createState();
          for (const option of options) {
            let branch = current;
            for (const literal of option) {
              const branchNext = createState();
              addEdge(branch, {
                to: branchNext,
                matches: (value, expected = literal) => value === expected,
              });
              branch = branchNext;
            }
            addEdge(branch, { to: next });
          }
          current = next;
          index = closeIndex + 1;
          continue;
        }
      }
    }
    const next = createState();
    addEdge(current, {
      to: next,
      matches: (value, expected = character) => value === expected,
    });
    current = next;
    index += 1;
  }
  return {
    start: 0,
    accept: current,
    edges,
  };
}

function epsilonClosure(
  automaton: GlobAutomaton,
  initial: Set<number>,
): Set<number> {
  const result = new Set(initial);
  const pending = [...initial];
  while (pending.length) {
    const state = pending.pop()!;
    for (const edge of automaton.edges[state]) {
      if (edge.matches || result.has(edge.to)) continue;
      result.add(edge.to);
      pending.push(edge.to);
    }
  }
  return result;
}

function reverseReachableStates(automaton: GlobAutomaton): Set<number> {
  const reverse = automaton.edges.map(() => [] as number[]);
  for (const [from, edges] of automaton.edges.entries()) {
    for (const edge of edges) reverse[edge.to].push(from);
  }
  const result = new Set([automaton.accept]);
  const pending = [automaton.accept];
  while (pending.length) {
    const state = pending.pop()!;
    for (const prior of reverse[state]) {
      if (result.has(prior)) continue;
      result.add(prior);
      pending.push(prior);
    }
  }
  return result;
}

function hasGlobSyntax(value: string): boolean {
  return value.includes('*') || value.includes('?') || value.includes('{');
}

function globToRegex(pattern: string): RegExp {
  let i = 0;
  let regex = '^';
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 2;
        if (pattern[i] === '/') {
          i += 1;
          regex += '(?:.+/)?';
        } else {
          regex += '.*';
        }
      } else {
        i += 1;
        regex += '[^/]*';
      }
    } else if (c === '?') {
      i += 1;
      regex += '[^/]';
    } else if (c === '{') {
      const closeIndex = pattern.indexOf('}', i + 1);
      if (closeIndex === -1) {
        regex += '\\{';
        i += 1;
        continue;
      }
      const options = pattern
        .slice(i + 1, closeIndex)
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean)
        .map(escapeRegex);
      regex += options.length ? `(?:${options.join('|')})` : '\\{\\}';
      i = closeIndex + 1;
    } else if (c === '.') {
      i += 1;
      regex += '\\.';
    } else {
      regex += escapeRegex(c);
      i += 1;
    }
  }
  return new RegExp(`${regex}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
