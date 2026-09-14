import crypto from "node:crypto";

const keyFor = (cli, content) => `${cli}-${crypto.createHash("sha256").update(content).digest("hex").slice(0, 8)}`;

export class ConcordNotifier {
  constructor({ inspectWork, updateWork, cli = "workrtai" } = {}) {
    this.inspectWork = inspectWork;
    this.updateWork = updateWork;
    this.cli = cli;
  }

  async notify(agentId, payload) {
    const presence = await this.inspectWork();
    const target = presence?.agents?.find((agent) => agent.agent_id === agentId && agent.promptable !== false);
    if (!target) throw new Error(`concord_agent_unavailable:${agentId}`);
    const content = `Workbench task ${payload.task_id} is ${payload.type}.\nSummary: ${payload.summary ?? ""}\nEvidence: ${(payload.evidence ?? []).join(", ")}`;
    return this.updateWork({ agent_id: payload.from_agent_id, operation: "prompt", to_agent_id: agentId, content, idempotency_key: keyFor(this.cli, content) });
  }

  async prompt({ fromAgentId, toAgentId, content }) {
    const presence = await this.inspectWork();
    const target = presence?.agents?.find((agent) => agent.agent_id === toAgentId && agent.promptable !== false);
    if (!target) throw new Error(`concord_agent_unavailable:${toAgentId}`);
    return this.updateWork({ agent_id: fromAgentId, operation: "prompt", to_agent_id: toAgentId, content, idempotency_key: keyFor(this.cli, content) });
  }

  reply({ fromAgentId, replyToMessageId, content }) {
    return this.updateWork({ agent_id: fromAgentId, operation: "reply", reply_to_message_id: replyToMessageId, content, idempotency_key: keyFor(this.cli, content) });
  }
}

