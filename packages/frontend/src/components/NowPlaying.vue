<script setup lang="ts">
import consola from "consola/browser"
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import TooltipIcon from "./TooltipIcon.vue"
import { useDiscordSdk } from "~/plugins/useDiscordSdk"
import { useStore } from "~/store"

const store = useStore()
const discordSdk = useDiscordSdk()
const log = consola.withTag("NowPlaying")

const skipped = ref(false)
const pauseToggling = ref(false)
const seeking = ref(false)
watch(
  () => store.session.video?.nonce,
  () => {
    skipped.value = false
  }
)

const nowTick = ref(Date.now())
let ticker: ReturnType<typeof setInterval>
onMounted(() => {
  ticker = setInterval(() => {
    nowTick.value = Date.now()
  }, 500)
})
onUnmounted(() => {
  clearInterval(ticker)
})
const position = computed(() => {
  const video = store.session.video
  if (!video) return 0
  return Math.max(
    0,
    Math.min(video.length * 1000, store.rawPosition(nowTick.value))
  )
})
const progress = computed(() => {
  const video = store.session.video
  if (!video || video.length === 0) return 0
  return position.value / (video.length * 1000)
})
const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${sec.toString().padStart(2, "0")}`
}
const timeText = computed(() => {
  const video = store.session.video
  if (!video) return ""
  return `${formatTime(position.value)} / ${formatTime(video.length * 1000)}`
})

const postAction = async (
  endpoint: "pause" | "resume" | "seek",
  body: Record<string, unknown>
) => {
  const resp = await fetch(`/api/room/${discordSdk.instanceId}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${store.me.id} ${store.token}`,
    },
    body: JSON.stringify({
      nonce: store.session.video?.nonce,
      ...body,
    }),
  })
  return resp.ok
}
const togglePause = async () => {
  if (pauseToggling.value || !store.session.video) return
  pauseToggling.value = true
  try {
    const paused = store.isPausedEffective
    const ok = await postAction(paused ? "resume" : "pause", {})
    if (ok) {
      store.setPausedOverride(!paused)
    } else {
      log.error(`Failed to ${paused ? "resume" : "pause"} video`)
    }
  } finally {
    pauseToggling.value = false
  }
}
const onSeek = async (event: MouseEvent) => {
  if (!store.canControl || seeking.value || !store.session.video) return
  seeking.value = true
  try {
    const bar = event.currentTarget as HTMLElement
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width)
    )
    const time = Math.round(ratio * store.session.video.length * 1000)
    const ok = await postAction("seek", { time })
    if (ok) {
      store.setSeekOverride(time)
    } else {
      log.error("Failed to seek video")
    }
  } finally {
    seeking.value = false
  }
}

const openVideo = () => {
  if (store.session.video) {
    discordSdk.commands.openExternalLink({
      url: `https://www.nicovideo.jp/watch/${store.session.video.id}`,
    })
  } else {
    discordSdk.commands.openExternalLink({
      url: "https://sevenc7c.com/kikoune",
    })
  }
}
const skipVideo = async () => {
  skipped.value = true
  const resp = await fetch(`/api/room/${discordSdk.instanceId}/skip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `${store.me.id} ${store.token}`,
    },
    body: JSON.stringify({
      nonce: store.session.video?.nonce,
    }),
  })
  if (!resp.ok) {
    log.error("Failed to skip video")
    skipped.value = false
  }
}
const openProfile = () => {
  discordSdk.commands.openExternalLink({
    url: "https://sevenc7c.com",
  })
}
const title = computed(() => store.session.video?.title ?? "Kikoune")
</script>
<template>
  <div class="*:bg-black/75 gap-2 flex-row relative">
    <div
      v-if="store.session.video"
      class="absolute top-0 left-0 w-full h-1 z-10 group"
      style="background-color: rgb(255 255 255 / 0.25)"
      :class="{ 'cursor-pointer': store.canControl }"
      @click="onSeek"
    >
      <div
        class="h-full bg-cyan-500 transition-[width] duration-500 ease-linear"
        :class="{ 'group-hover:bg-cyan-400': store.canControl }"
        :style="{ width: `${progress * 100}%` }"
      />
    </div>
    <div
      class="h-full aspect-square bg-slate-500 relative rounded overflow-hidden hidden sm:block"
    >
      <div
        class="absolute inset-[-16%] bg-cover bg-center"
        :style="{
          backgroundImage: `url('${store.thumbnailUrl}')`,
        }"
      />
    </div>
    <div
      class="h-full p-2 flex-grow flex flex-col sm:flex-row items-start sm:items-center info-container"
    >
      <div class="my-auto flex-grow text-section">
        <h2 class="text-xl font-bold">
          {{ title }}
        </h2>
        <p class="text-md">
          <template v-if="store.session.video">
            {{ store.session.video.author }}
          </template>
          <template v-else>
            Developed by
            <span
              class="text-[#48b0d5] cursor-pointer hover:underline"
              @click="openProfile"
              >Nanashi.</span
            >
          </template>
        </p>
      </div>
      <div
        v-if="store.session.video"
        class="w-full sm:w-auto xs:max-sm:pt-2 flex flex-row items-center"
      >
        <TooltipIcon
          name="md-openinnew"
          tooltip="ブラウザで開く"
          offset="2rem"
          class="w-6 h-6 mr-2 hidden xs:max-sm:block"
          @click="openVideo"
        />
        <TooltipIcon
          v-if="store.canControl"
          :name="store.isPausedEffective ? 'md-playarrow' : 'md-pause'"
          :tooltip="store.isPausedEffective ? '再生' : '一時停止'"
          :disabled="pauseToggling"
          class="w-6 h-6 mr-2"
          @click="togglePause"
        />
        <TooltipIcon
          v-if="
            store.canControl || store.session.video.requestedBy === store.me.id
          "
          name="md-fastforward"
          tooltip="スキップ"
          :disabled="skipped"
          class="w-6 h-6 mr-2"
          @click="skipVideo"
        />
        <span class="text-xs mr-2 hidden sm:inline">{{ timeText }}</span>
        <div class="flex-grow sm:hidden" />
        <span class="text-sm requester-name">
          {{ store.getName(store.session.video.requestedBy) }}
        </span>
        <img
          class="rounded-full ml-1 w-6 h-6"
          :src="store.getAvatarUrl(store.session.video.requestedBy)"
        />
      </div>
    </div>
    <a
      class="h-full aspect-square place-items-center transition-colors hidden sm:grid hover:bg-black cursor-pointer"
      @click="openVideo"
    >
      <v-icon
        name="md-openinnew"
        class="w-1/2 h-1/2"
        :disabled="!store.session.video"
      />
    </a>
  </div>
</template>
<style scoped lang="scss">
@media (max-height: 480px) {
  .requester-name {
    display: none;
  }
  .text-section {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 1rem;

    margin-top: 0;
    margin-bottom: 0;
  }
  .info-container {
    padding: 0 0.5rem;
  }
}
</style>
