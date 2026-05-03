// Re-export the QStash-compatible queue. When SELF_HOSTED=1, this resolves to
// a BullMQ-backed adapter; otherwise to the real Upstash @upstash/qstash Client.
export { qstash, CRON_BATCH_SIZE } from "@/lib/queue";
