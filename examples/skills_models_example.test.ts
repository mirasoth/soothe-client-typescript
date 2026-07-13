/**
 * Skills & Models examples: listSkills, listModels, fetchSkillsCatalog
 * helper, and invokeSkill.
 *
 * Mirrors the Go client's `skills_models_example_test.go`.
 */

import { describe, it, expect } from "vitest";
import { Client, fetchSkillsCatalog, fetchConfigSection } from "../src/index.js";
import { createMockDaemon } from "./helpers/mock-server.js";

describe("Example: skills catalog", () => {
  it("listSkills: blocking request/response via client.listSkills", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // listSkills sends skills_list and blocks for the response.
      const result = await client.listSkills(15_000);

      const skills = result.skills as Array<Record<string, unknown>>;
      for (const s of skills) {
        console.log("  - %s: %s", s.name, s.description);
      }

      client.close();
      expect(skills).toHaveLength(3);
      expect(skills[0]).toMatchObject({ name: "research", description: "Research skill" });
    } finally {
      await md.close();
    }
  });

  it("fetchSkillsCatalog: package-level helper returns typed array", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      // fetchSkillsCatalog returns Record<string, unknown>[] for direct iteration.
      const skills = await fetchSkillsCatalog(client, 15_000);
      for (const s of skills) {
        console.log("  - %s", s.name);
      }

      client.close();
      expect(skills).toHaveLength(3);
      expect(skills.map(s => s.name)).toEqual(["research", "browser", "code_reviewer"]);
    } finally {
      await md.close();
    }
  });

  it("invokeSkill: invokes a skill on the daemon host", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await client.invokeSkill("research", "TypeScript best practices", 120_000);
      console.log("Skill result:", result);

      client.close();
      expect(result).toMatchObject({ success: true, skill: "research" });
    } finally {
      await md.close();
    }
  });

  it("invokeSkill: no args (empty string)", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await client.invokeSkill("code_reviewer", undefined, 120_000);
      console.log("Skill (no args):", result);

      client.close();
      expect(result).toMatchObject({ skill: "code_reviewer" });
    } finally {
      await md.close();
    }
  });
});

describe("Example: models catalog", () => {
  it("listModels: blocking request/response via client.listModels", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const result = await client.listModels(15_000);
      const models = result.models as Array<Record<string, unknown>>;
      for (const m of models) {
        console.log("  - %s: %s", m.id, m.name);
      }

      client.close();
      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({ id: "openai:gpt-4o", name: "GPT-4o" });
    } finally {
      await md.close();
    }
  });
});

describe("Example: config section (related to skills/models)", () => {
  it("fetchConfigSection: fetches a daemon config section", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      const section = await fetchConfigSection(client, "model", 5_000);
      console.log("Config section:", section);

      client.close();
      expect(section).toBeDefined();
    } finally {
      await md.close();
    }
  });

  it("sendConfigGet: fire-and-forget config request", async () => {
    const md = createMockDaemon();
    try {
      const client = new Client(md.url);
      await client.connect();

      await client.sendConfigGet("model");
      console.log("Config request sent");

      client.close();
      expect(true).toBe(true);
    } finally {
      await md.close();
    }
  });
});
