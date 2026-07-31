// room ルートの一時停止・再開・シーク・共有モード権限のスモークテスト（手動実行用）
import assert from "node:assert/strict"
import room from "./src/routes/room.ts"
import * as db from "./src/db.ts"
import { buffer, defaultSessionSetting } from "@kikoune/shared"

const roomId = "smoke-route-room"
const hostToken = await db.createToken("host1", "inst")
const userToken = await db.createToken("user1", "inst")

const call = (method, path, userId, token, body) =>
  room.fetch(
    new Request(`http://localhost/${roomId}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `${userId} ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  )

const seedSession = async (overrides = {}) => {
  const session = {
    video: { videoId: "sm9", requestedBy: "host1", nonce: "nonce-current" },
    startedAt: Date.now() - 10000,
    pausedAt: null,
    queue: [
      { videoId: "sm9", requestedBy: "host1", nonce: "nonce-queued-1" },
      { videoId: "sm9", requestedBy: "user1", nonce: "nonce-queued-2" },
    ],
    host: "host1",
    setting: { ...defaultSessionSetting },
    ...overrides,
  }
  await db.redis.set(`room:${roomId}:session`, JSON.stringify(session))
  return session
}

await db.redis.del(`room:${roomId}:session`)

// 認証なしは401
{
  const res = await room.fetch(
    new Request(`http://localhost/${roomId}/pause`, { method: "POST" })
  )
  assert.equal(res.status, 401)
}

await seedSession()

// ホスト以外（共有オフ）は pause できない
{
  const res = await call("POST", "/pause", "user1", userToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 403)
}
// nonce が違うと400
{
  const res = await call("POST", "/pause", "host1", hostToken, {
    nonce: "wrong",
  })
  assert.equal(res.status, 400)
}
// ホストは pause できる
{
  const res = await call("POST", "/pause", "host1", hostToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.ok(session.pausedAt !== null)
}
// ホストは resume できる
{
  const res = await call("POST", "/resume", "host1", hostToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.equal(session.pausedAt, null)
}
// シーク（sm9の長さにクランプされ、位置がtimeになる）
{
  const res = await call("POST", "/seek", "host1", hostToken, {
    nonce: "nonce-current",
    time: 30000,
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  const pos = Date.now() - session.startedAt - buffer
  assert.ok(Math.abs(pos - 30000) < 2000, `pos=${pos}`)
}
// 共有オフで他人の動画は skip できない
{
  const res = await call("POST", "/skip", "user1", userToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 403)
}
// 設定変更で共有モードを有効化（ホストのみ）
{
  const forbidden = await call("PUT", "/setting", "user1", userToken, {
    controlShared: true,
  })
  assert.equal(forbidden.status, 403)
  const res = await call("PUT", "/setting", "host1", hostToken, {
    controlShared: true,
  })
  assert.equal(res.status, 204)
}
// 共有オンなら他人の動画も skip / pause / 並び替え / 削除できる
{
  const res = await call("POST", "/pause", "user1", userToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.ok(session.pausedAt !== null)
}
{
  const res = await call("POST", "/skip", "user1", userToken, {
    nonce: "nonce-current",
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.equal(session.video.nonce, "nonce-queued-1")
  assert.equal(session.pausedAt, null)
}
// 並び替え検証用にキューを補充する
{
  const session = await db.getSession(roomId)
  session.queue.push({
    videoId: "sm9",
    requestedBy: "host1",
    nonce: "nonce-queued-3",
  })
  await db.redis.set(`room:${roomId}:session`, JSON.stringify(session))
}
{
  const res = await call("PUT", "/queue", "user1", userToken, {
    order: ["nonce-queued-3", "nonce-queued-2"],
  })
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.deepEqual(
    session.queue.map((v) => v.nonce),
    ["nonce-queued-3", "nonce-queued-2"]
  )
}
{
  const res = await call("DELETE", "/queue/nonce-queued-3", "user1", userToken)
  assert.equal(res.status, 204)
  const session = await db.getSession(roomId)
  assert.deepEqual(
    session.queue.map((v) => v.nonce),
    ["nonce-queued-2"]
  )
}

// /sync: 一時停止中は動画終了後でもデキューされず、再開後はデキューされる
{
  // sm9 は5:20（320秒）。400秒前に開始したら終了済み。
  // 100秒前に一時停止した場合、その時点の再生位置は295秒なので終了扱いにならない
  const startedAt = Date.now() - 400_000
  const pausedAt = Date.now() - 100_000
  await seedSession({
    startedAt,
    pausedAt,
    queue: [{ videoId: "sm9", requestedBy: "host1", nonce: "nonce-next" }],
  })
  const res = await call("PUT", "/sync", "host1", hostToken, {
    userIds: ["host1"],
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(
    data.session.video?.nonce,
    "nonce-current",
    "一時停止中はデキューされないこと"
  )
  assert.equal(data.session.pausedAt, pausedAt, "pausedAtが返ること")

  // 再開（pausedAt解除）すると終了済みなのでデキューされる
  const session = await db.getSession(roomId)
  session.pausedAt = null
  await db.redis.set(`room:${roomId}:session`, JSON.stringify(session))
  const res2 = await call("PUT", "/sync", "host1", hostToken, {
    userIds: ["host1"],
  })
  assert.equal(res2.status, 200)
  const data2 = await res2.json()
  assert.equal(
    data2.session.video?.nonce,
    "nonce-next",
    "再開後はデキューされること"
  )
}

await db.redis.del(`room:${roomId}:session`)
await db.redis.del("token:host1")
await db.redis.del("token:user1")
await db.redis.quit()
console.log("route smoke test: all assertions passed")
