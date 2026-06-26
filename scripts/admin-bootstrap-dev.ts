import { bootstrapAdminForDevelopment } from "../src/lib/server/auth";
import { closeDb, withDatabaseStartupRetry } from "../src/lib/server/db";

type ParsedArgs = {
  email: string;
  password: string;
};

const HELP_TEXT = `
Usage:
  bun run admin:bootstrap-dev -- --email owner@example.com --password 'correct horse battery staple'

Options:
  --email       Admin email to create
  --password    Admin password to hash and store
  --help        Show this message
`.trim();

function getFlagValue(
  argv: string[],
  index: number,
  flag: string,
): string | undefined {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function parseAdminBootstrapDevArgs(
  argv: string[] = process.argv.slice(2),
): ParsedArgs {
  let email: string | undefined;
  let password: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      throw new Error(HELP_TEXT);
    }

    if (argument === "--email") {
      email = getFlagValue(argv, index, "--email");
      index += 1;
      continue;
    }

    if (argument === "--password") {
      password = getFlagValue(argv, index, "--password");
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!email || !password) {
    throw new Error(
      `Both --email and --password are required.\n\n${HELP_TEXT}`,
    );
  }

  return { email, password };
}

async function main() {
  const { email, password } = parseAdminBootstrapDevArgs();
  const result = await withDatabaseStartupRetry(
    () =>
      bootstrapAdminForDevelopment({
        email,
        password,
      }),
    { operationName: "admin bootstrap" },
  );

  if (!result.ok) {
    throw new Error(result.error);
  }

  if (result.created) {
    console.log("Created development admin account.");
  } else {
    console.log("Admin already exists, leaving it unchanged.");
  }
  console.log(`Email: ${result.email}`);

  if (result.created) {
    console.log(
      "Visit /admin/login and sign in with the password you provided.",
    );
  }
}

if (import.meta.main) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Failed to create development admin account.",
      );
      process.exit(1);
    })
    .finally(async () => {
      await closeDb();
    });
}
