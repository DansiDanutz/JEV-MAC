import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { commands, request, type Command } from "./client.ts";

const schemas: Record<Command, object> = {
  status: {
    type: "object",
    properties: {
      search: { type: "string" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  scan: {
    type: "object",
    properties: { rootId: { type: "string" } },
    required: ["rootId"],
    additionalProperties: false,
  },
  cancel: {
    type: "object",
    properties: { jobId: { type: "string" } },
    required: ["jobId"],
    additionalProperties: false,
  },
  plan: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["organize", "quarantine"] },
      fileIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 100,
      },
    },
    required: ["kind", "fileIds"],
    additionalProperties: false,
  },
  classify_preview: {
    type: "object",
    properties: {
      fileIds: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 20,
      },
    },
    required: ["fileIds"],
    additionalProperties: false,
  },
};
const server = new Server(
  { name: "jev-mac", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(commands).map(([name, spec]) => ({
    name: `jev_mac_${name}`,
    description: spec.description,
    inputSchema: schemas[name as Command],
    annotations: {
      readOnlyHint: name === "status" || name === "classify_preview",
      destructiveHint: false,
      openWorldHint: false,
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const name = params.name.replace(/^jev_mac_/, "") as Command;
  try {
    if (!Object.hasOwn(commands, name)) throw Error("Unknown JEV-MAC tool");
    const result = await request(name, params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: e instanceof Error ? e.message : "Local tool failed",
        },
      ],
    };
  }
});
await server.connect(new StdioServerTransport());
