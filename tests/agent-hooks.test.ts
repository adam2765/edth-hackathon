import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// One hook list and one set of skills serve Claude Code and Codex; .agents/ holds the files
// (CONTRIBUTING.md, Coding agents).
const root = fileURLToPath(new URL("..", import.meta.url));
const hooksDir = join(root, ".agents", "hooks");
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
const hasPython = spawnSync("python3", ["--version"]).status === 0;

// Built at runtime so this file never holds a key-shaped literal.
const mistralKey = "Q7".repeat(16);
const openaiKey = "sk-" + "proj-" + "Q7".repeat(15);

type HookOutput = { permissionDecision?: string; additionalContext?: string } | null;

function runHook(script: string, payload: object): HookOutput {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const result = spawnSync("python3", [join(hooksDir, script)], {
    input: JSON.stringify(payload),
    cwd: root,
    env,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

const bash = (command: string, cwd = root) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  cwd,
  tool_input: { command },
});
const write = (content: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: "lib/example.ts", content },
});

describe("agent hooks and skills", () => {
  it("are registered the same for Claude Code and Codex", () => {
    expect(readJson(".codex/hooks.json").hooks).toEqual(readJson(".claude/settings.json").hooks);
  });

  it("each run a script in .agents/hooks", () => {
    const groups = Object.values(
      readJson(".claude/settings.json").hooks as Record<string, { hooks: { command: string }[] }[]>,
    ).flat();
    const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const script = command.match(/\.agents\/hooks\/([\w-]+\.py)/)?.[1];
      expect(script, `no .agents/hooks script in: ${command}`).toBeTruthy();
      expect(existsSync(join(hooksDir, script!)), `missing ${script}`).toBe(true);
    }
  });

  // Windows checkouts that do not support symlinks store the link as a plain file; the check
  // runs on the Mac and on CI.
  it.skipIf(process.platform === "win32")("share one skills folder: .claude/skills links to .agents/skills", () => {
    const link = join(root, ".claude", "skills");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(join(root, ".agents", "skills")));
  });
});

describe.skipIf(!hasPython)("guard hooks", () => {
  it("guard-secrets refuses to read .env.local and allows .env.example", () => {
    expect(runHook("guard-secrets.py", bash("cat .env.local"))?.permissionDecision).toBe("deny");
    const read = { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(root, ".env.local") } };
    expect(runHook("guard-secrets.py", read)?.permissionDecision).toBe("deny");
    expect(runHook("guard-secrets.py", bash("cat .env.example"))).toBeNull();
  });

  it("guard-key-literals refuses a key written into a file, not one read from the environment", () => {
    expect(runHook("guard-key-literals.py", write(`MISTRAL_API_KEY=${mistralKey}`))?.permissionDecision).toBe("deny");
    expect(runHook("guard-key-literals.py", write(`const key = "${openaiKey}";`))?.permissionDecision).toBe("deny");
    expect(runHook("guard-key-literals.py", write("const key = process.env.MISTRAL_API_KEY;"))).toBeNull();
    expect(runHook("guard-key-literals.py", write("MISTRAL_API_KEY="))).toBeNull();
  });

  it("guard-key-literals refuses a Codex apply_patch that adds a key", () => {
    const patch = `*** Begin Patch\n*** Add File: lib/client.ts\n+const key = "${openaiKey}";\n*** End Patch`;
    const payload = { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: patch } };
    expect(runHook("guard-key-literals.py", payload)?.permissionDecision).toBe("deny");
  });

  it("guard-delete-outside allows rm inside the repo and refuses it outside", () => {
    const cwd = join(root, "lib");
    expect(runHook("guard-delete-outside.py", bash("rm -rf ../tests/tmp-scratch", cwd))).toBeNull();
    expect(runHook("guard-delete-outside.py", bash("rm -rf ../../some-other-repo", cwd))?.permissionDecision).toBe("deny");
  });

  it("guard-worktree-path keeps worktrees in .claude/worktrees", () => {
    // An absolute path: from inside a worktree, ../x is a sibling in .claude/worktrees and allowed.
    const outside = join(tmpdir(), "edth-feature");
    expect(runHook("guard-worktree-path.py", bash(`git worktree add ${outside} -b feature`))?.permissionDecision).toBe(
      "deny",
    );
    expect(runHook("guard-worktree-path.py", bash("git worktree add .claude/worktrees/feature -b feature"))).toBeNull();
  });
});
