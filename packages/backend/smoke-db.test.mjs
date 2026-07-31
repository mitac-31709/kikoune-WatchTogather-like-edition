// db.ts の一時停止・再開・シークの状態遷移スモークテスト（手動実行用）
import assert from "node:assert/strict"
import * as db from "./src/db.ts"

const room = "smoke-test-room"
const buffer = 5000

await db.redis.del(`room:${room}:session`)

// セッション作成
const created = await db.createSession(room, "host1")
assert.equal(created.pausedAt, null)
assert.equal(created.setting.controlShared, false)

// 古い形式（pausedAt / controlShared なし）の正規化
await db.redis.set(
  `room:${room}:session`,
  JSON.stringify({
    video: null,
    startedAt: Date.now(),
    queue: [],
    host: "host1",
    setting: { queueLimit: 100, queueLocked: false, queueHidden: false, random: false },
  })
)
const legacy = await db.getSession(room)
assert.equal(legacy.pausedAt, null)
assert.equal(legacy.setting.controlShared, false)

// キュー投入とデキュー
await db.enqueueVideo(room, "sm1", "host1")
await db.enqueueVideo(room, "sm2", "user2")
let session = await db.getSession(room)
assert.equal(session.queue.length, 2)
await db.dequeueVideo(room, session)
session = await db.getSession(room)
assert.equal(session.video.videoId, "sm1")
assert.equal(session.pausedAt, null)

// 一時停止
const beforePause = session.startedAt
await new Promise((r) => setTimeout(r, 50))
await db.pauseVideo(room)
session = await db.getSession(room)
assert.ok(session.pausedAt !== null && session.pausedAt > beforePause)
assert.equal(session.startedAt, beforePause)
// 二重 pause は無視
const pausedAt1 = session.pausedAt
await db.pauseVideo(room)
session = await db.getSession(room)
assert.equal(session.pausedAt, pausedAt1)

// 再開（startedAt が停止分だけ進む）
await new Promise((r) => setTimeout(r, 100))
await db.resumeVideo(room)
session = await db.getSession(room)
assert.equal(session.pausedAt, null)
assert.ok(session.startedAt >= beforePause + 90, `startedAt=${session.startedAt}, before=${beforePause}`)

// シーク（再生中）: 再生位置が time になる
await db.seekVideo(room, 60000)
session = await db.getSession(room)
const pos = Date.now() - session.startedAt - buffer
assert.ok(Math.abs(pos - 60000) < 500, `pos=${pos}`)

// 一時停止中のシーク: 位置が変わり停止状態を維持
await db.pauseVideo(room)
await db.seekVideo(room, 30000)
session = await db.getSession(room)
assert.ok(session.pausedAt !== null)
const pausedPos = session.pausedAt - session.startedAt - buffer
assert.ok(Math.abs(pausedPos - 30000) < 500, `pausedPos=${pausedPos}`)

// スキップで次の動画へ、停止状態はリセット
await db.skipVideo(room)
session = await db.getSession(room)
assert.equal(session.video.videoId, "sm2")
assert.equal(session.pausedAt, null)

await db.redis.del(`room:${room}:session`)
await db.redis.quit()
console.log("smoke test: all assertions passed")
