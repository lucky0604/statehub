/* eslint-disable no-console -- CLI script, console output is the point */
/**
 * add-user — create or reset a StateHub user with an email + password.
 *
 * Usage (local dev):
 *   pnpm --filter @statehub/web run add-user -- --email=foo@bar.com --name=Foo
 *   # password prompted interactively, or pass --password=...
 *
 * Usage (production D1):
 *   pnpm --filter @statehub/web run add-user -- --email=foo@bar.com --name=Foo --password=... --remote
 *   # shells out to `wrangler d1 execute statehub-local --remote`
 *
 * If the email already exists, the script updates the password hash + name
 * (idempotent re-run, no duplicate rows).
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.10
 */
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { getDb } from "@statehub/db/node";
import { authService } from "@statehub/domain";

interface Args {
  email: string | null;
  name: string | null;
  password: string | null;
  remote: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { email: null, name: null, password: null, remote: false };
  for (const a of argv.slice(2)) {
    if (a === "--") continue; // pnpm/npm pass-through separator
    else if (a.startsWith("--email=")) args.email = a.slice(8);
    else if (a.startsWith("--name=")) args.name = a.slice(7);
    else if (a.startsWith("--password=")) args.password = a.slice(11);
    else if (a === "--remote") args.remote = true;
    else if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      console.error(USAGE);
      process.exit(1);
    }
  }
  return args;
}

const USAGE =
  "Usage: add-user --email=foo@bar.com --name=Foo [--password=secret] [--remote]";

async function promptPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Password (min 8 chars): ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.email || !args.name) {
    console.error(USAGE);
    process.exit(1);
  }
  const password = args.password ?? (await promptPassword());
  if (!password) {
    console.error("password is required");
    process.exit(1);
  }

  const hash = await authService.hashPassword(password);
  const email = args.email.trim().toLowerCase();
  const name = args.name.trim();
  const id = crypto.randomUUID();
  const now = Date.now();

  if (args.remote) {
    runRemote({ id, email, name, hash, now });
    return;
  }

  const db = getDb();
  const existing = await db.first<{ id: string }>(
    "SELECT id FROM users WHERE email = ? AND deleted_at IS NULL",
    [email],
  );
  if (existing) {
    await db.run(
      "UPDATE users SET password_hash = ?, name = ?, updated_at = ? WHERE id = ?",
      [hash, name, now, existing.id],
    );
    console.log(`✓ Reset password for existing user ${email} (${existing.id})`);
  } else {
    await db.run(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, email, name, hash, now, now],
    );
    console.log(`✓ Created user ${email} (${id})`);
  }
}

function runRemote(input: {
  id: string;
  email: string;
  name: string;
  hash: string;
  now: number;
}) {
  // Escape single quotes in strings for SQL. bcrypt hashes and UUIDs are
  // safe by construction; names/emails could contain quotes.
  const sql = `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, version)
       VALUES ('${input.id}', '${input.email.replace(/'/g, "''")}', '${input.name.replace(/'/g, "''")}', '${input.hash}', ${input.now}, ${input.now}, 1);`;

  console.log("Running on remote D1 via wrangler…");
  try {
    execFileSync(
      "wrangler",
      ["d1", "execute", "statehub-local", "--remote", `--command=${sql}`],
      { stdio: "inherit" },
    );
    console.log(`✓ Created user ${input.email} (${input.id}) on remote D1`);
  } catch (e) {
    console.error("Failed to run wrangler. Make sure you're logged in and the D1 binding is configured.");
    console.error(e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
