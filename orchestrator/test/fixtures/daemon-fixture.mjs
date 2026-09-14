import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";

const args = new Map(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
const discoveryPath = args.get("discovery");
const token = args.get("token") || "fixture-token";
if (!discoveryPath) throw new Error("--discovery is required");

const sessions = new Map();
const server = createServer((socket) => {
  let authenticated = false;
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const frame = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      if (!authenticated) {
        if (frame.type !== "auth" || frame.token !== token) { socket.write(JSON.stringify({ type: "auth_err", message: "invalid_token" }) + "\n"); socket.destroy(); return; }
        authenticated = true;
        socket.write(JSON.stringify({ type: "auth_ok", protocol_version: 1, features: ["attach", "output", "exit", "hook_report"], daemon_version: "fixture", pid: process.pid }) + "\n");
        continue;
      }
      const reply = { type: frame.type === "list" ? "sessions" : "ok", id: frame.id };
      if (frame.type === "create") sessions.set(frame.session_id, { session_id: frame.session_id, alive: true });
      if (frame.type === "close") { sessions.delete(frame.session_id); socket.write(JSON.stringify(reply) + "\n"); socket.write(JSON.stringify({ type: "exit", session_id: frame.session_id, exit_code: 0 }) + "\n"); continue; }
      socket.write(JSON.stringify(reply) + "\n");
      if (frame.type === "attach") socket.write(JSON.stringify({ type: "output", session_id: frame.session_id, data_base64: Buffer.from("fixture-output").toString("base64") }) + "\n");
    }
  });
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  await writeFile(discoveryPath, JSON.stringify({ port, token, protocol_version: 1, features: ["attach", "output", "exit", "hook_report"], pid: process.pid }));
  process.stdout.write(JSON.stringify({ ready: true, port }) + "\n");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));

