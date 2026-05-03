import { APP_DOMAIN_WITH_NGROK, log } from "@dub/utils";

const SELF_HOSTED = process.env.SELF_HOSTED === "1";

const WORKFLOW_RETRIES = 3;
const WORKFLOW_PARALLELISM = 20;

type WorkflowIds = "partner-approved";

interface QStashWorkflow {
  workflowId: WorkflowIds;
  body?: Record<string, unknown>;
}

// Run workflows
export async function triggerWorkflows(
  input: QStashWorkflow | QStashWorkflow[],
) {
  try {
    const workflows = Array.isArray(input) ? input : [input];

    if (SELF_HOSTED) {
      const { qstash } = await import("@/lib/queue");
      const results = await Promise.all(
        workflows.map((wf) =>
          qstash.publishJSON({
            url: `${APP_DOMAIN_WITH_NGROK}/api/workflows/${wf.workflowId}`,
            body: wf.body,
            retries: WORKFLOW_RETRIES,
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
          }),
        ),
      );
      return results;
    }

    const { Client } = await import("@upstash/workflow");
    const client = new Client({ token: process.env.QSTASH_TOKEN || "" });

    const results = await client.trigger(
      workflows.map((workflow) => ({
        url: `${APP_DOMAIN_WITH_NGROK}/api/workflows/${workflow.workflowId}`,
        body: workflow.body,
        retries: WORKFLOW_RETRIES,
        flowControl: {
          key: workflow.workflowId,
          parallelism: WORKFLOW_PARALLELISM,
        },
      })),
    );

    if (process.env.NODE_ENV === "development") {
      console.debug("[Upstash] Workflows triggered", {
        count: workflows.length,
        ids: workflows.map((w) => w.workflowId),
        results,
      });
    }

    return results;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);

    console.error("[Upstash] Failed to trigger workflows", {
      error: message,
      input,
    });

    await log({
      message: `[Upstash] Failed to trigger QStash workflows. ${message}`,
      type: "errors",
    });

    return null;
  }
}
