import { commands, request, type Command } from "./client.ts";

const [command = "help", raw = "{}"] = process.argv.slice(2);
if (command === "help") {
  console.log(
    'JEV-MAC agent CLI\nUsage: npm run cli -- <command> \'{"argument":"value"}\'\n',
  );
  for (const [name, spec] of Object.entries(commands))
    console.log(`${name}: ${spec.description}`);
  console.log(
    "\nApprove roots, metadata uploads, apply and restore in the local dashboard. No automatic deletion.",
  );
} else if (!(command in commands)) {
  console.error("Unknown command. Run npm run cli -- help");
  process.exitCode = 1;
} else {
  try {
    const result = await request(command as Command, JSON.parse(raw));
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Request failed");
    process.exitCode = 1;
  }
}
