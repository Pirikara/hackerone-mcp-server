import assert from "node:assert/strict";
import test from "node:test";

process.env.H1_USERNAME = "test-user";
process.env.H1_API_TOKEN = "test-token";

const requests = [];
let responseData;
let responseQueue = [];

globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), init });
  const payload = responseQueue.length ? responseQueue.shift() : responseData;
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const {
  createReportIntent,
  listReportIntents,
  submitReportIntent,
  updateReportIntent,
} = await import("../dist/h1client.js");

function intentResponse(overrides = {}) {
  return {
    data: {
      id: "418576",
      type: "report-intent",
      attributes: {
        title: "Generated title",
        description: "Full finding",
        state: "ready_to_submit",
        metadata: { bug_class: "Path Traversal" },
      },
      relationships: {
        program: { data: { id: "55", type: "program" } },
        report: { data: null },
        attachments: { data: [] },
      },
      ...overrides,
    },
  };
}

test.beforeEach(() => {
  requests.length = 0;
  responseQueue = [];
  responseData = intentResponse();
});

test("createReportIntent sends only documented writable attributes", async () => {
  const result = await createReportIntent({
    program_handle: "security",
    description: "Full finding",
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.hackerone.com/v1/hackers/report_intents"
  );
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    data: {
      type: "report-intent",
      attributes: {
        team_handle: "security",
        description: "Full finding",
      },
    },
  });
  assert.deepEqual(result.program, {
    id: "55",
    type: "program",
    handle: null,
    name: null,
  });
  assert.equal(
    result.report_assistant_url,
    "https://hackerone.com/hai/report_assistant"
  );
});

test("updateReportIntent only updates the documented description field", async () => {
  await updateReportIntent("418576", "Updated finding");

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.hackerone.com/v1/hackers/report_intents/418576"
  );
  assert.equal(requests[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    data: {
      type: "report-intent",
      attributes: { description: "Updated finding" },
    },
  });
});

test("listReportIntents preserves a program relationship that only has an id", async () => {
  responseData = { data: [intentResponse().data] };

  const [intent] = await listReportIntents(100, 1);

  assert.equal(intent.program.id, "55");
  assert.equal(intent.program.handle, null);
});

test("submitReportIntent refreshes an omitted relationship to get the real report id", async () => {
  responseQueue = [
    intentResponse(),
    intentResponse({
      relationships: {
        program: { data: { id: "55", type: "program" } },
        report: { data: { id: "987654", type: "report" } },
        attachments: { data: [] },
      },
    }),
  ];

  const result = await submitReportIntent("418576");

  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[1].init.method, "GET");
  assert.equal(result.report_id, "987654");
  assert.equal(result.url, "https://hackerone.com/reports/987654");
});

test("submitReportIntent never treats the intent id as a report id", async () => {
  const result = await submitReportIntent("418576");

  assert.equal(result.report_id, null);
  assert.equal(result.url, null);
});
