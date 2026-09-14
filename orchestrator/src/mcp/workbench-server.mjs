const TOOLS = [
  { name: "create_task", description: "Create a review, handoff, child, or integration task", inputSchema: { type: "object" } },
  { name: "dispatch_task", description: "Dispatch a task to an assigned CLI session", inputSchema: { type: "object", required: ["task_id"] } },
  { name: "handoff_task", description: "Assign a reviewer or child agent and dispatch it", inputSchema: { type: "object", required: ["task_id"] } },
  { name: "ask_agent", description: "Send a follow-up message to a bound agent", inputSchema: { type: "object", required: ["task_id", "message"] } },
  { name: "list_tasks", description: "List tasks for a run or parent", inputSchema: { type: "object" } },
  { name: "recover_tasks", description: "Reconcile running tasks with daemon sessions after restart", inputSchema: { type: "object" } },
  { name: "post_progress", description: "Append progress to a running task", inputSchema: { type: "object", required: ["task_id", "message"] } },
  { name: "post_result", description: "Post an idempotent terminal task result", inputSchema: { type: "object", required: ["task_id", "status", "result_version"] } },
  { name: "get_task", description: "Read task, children, events, agents, and artifacts", inputSchema: { type: "object", required: ["task_id"] } },
  { name: "checkpoint", description: "Persist a resumable run checkpoint", inputSchema: { type: "object", required: ["run_id"] } },
  { name: "evaluate_gate", description: "Evaluate task quality gate evidence", inputSchema: { type: "object", required: ["task_id", "gate_id"] } },
];

export class WorkbenchMcpServer {
  constructor(bridge) { this.bridge = bridge; }

  async handle(request) {
    if (request.method === "initialize") return { protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "workrtai-workbench", version: "0.1.0" } };
    if (request.method === "notifications/initialized") return undefined;
    if (request.method === "tools/list") return { tools: TOOLS };
    if (request.method !== "tools/call") throw new Error(`unsupported_mcp_method:${request.method}`);
    const { name, arguments: args = {} } = request.params ?? {};
    let value;
    if (name === "create_task") value = this.bridge.createTask(args);
    else if (name === "dispatch_task") value = await this.bridge.dispatchTask(args.task_id);
    else if (name === "handoff_task") value = await this.bridge.handoff(args.task_id, args);
    else if (name === "ask_agent") value = await this.bridge.ask(args.task_id, args.message);
    else if (name === "list_tasks") value = this.bridge.listTasks(args);
    else if (name === "recover_tasks") value = await this.bridge.recoverRunningTasks();
    else if (name === "post_progress") value = this.bridge.postProgress(args.task_id, args);
    else if (name === "post_result") value = await this.bridge.postResult(args.task_id, args);
    else if (name === "get_task") value = this.bridge.getTask(args.task_id);
    else if (name === "checkpoint") value = this.bridge.checkpoint(args.run_id, args.state ?? {});
    else if (name === "evaluate_gate") value = this.bridge.evaluateGate(args.task_id, args.gate_id);
    else throw new Error(`unknown_workbench_tool:${name}`);
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
  }

  async serve(input = process.stdin, output = process.stdout) {
    let buffer = "";
    for await (const chunk of input) {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        if (!request.id) { await this.handle(request); continue; }
        try { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: await this.handle(request) })}\n`); }
        catch (error) { output.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } })}\n`); }
      }
    }
  }
}
