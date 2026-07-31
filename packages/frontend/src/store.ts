import { defineStore } from "pinia"
import {
  MemberState,
  SessionSetting,
  Session,
  buffer,
  defaultSessionSetting,
} from "@kikoune/shared"
import { Participant } from "./plugins/useDiscordSdk.ts"

export const sessionNotStarted = 0
export const useStore = defineStore("main", {
  state: () => ({
    _token: "",
    session: {
      queue: [],
      startedAt: sessionNotStarted,
      pausedAt: null,
      host: "",
      video: undefined,
      setting: defaultSessionSetting,
    } as Session,
    memberStates: {} as Record<string, MemberState>,
    _me: undefined as Participant | undefined,
    stateOverride: {} as Partial<MemberState>,
    stateOverrideUpdatedAt: 0,
    settingOverride: {} as Partial<SessionSetting>,
    pausedOverride: undefined as
      | { nonce: string; paused: boolean; at: number; position: number }
      | undefined,
    seekOverride: undefined as
      | { nonce: string; at: number; time: number }
      | undefined,

    participants: [] as Participant[],
    allParticipants: [] as Participant[],
    view: "login" as "login" | "main" | "error",
    isHostOverride: undefined as boolean | undefined,
    debug: false,
    delay: 0,
  }),
  getters: {
    token(state) {
      if (!state._token) {
        throw new Error("Token is not set")
      }
      return state._token
    },
    me(state) {
      if (!state._me) {
        throw new Error("Me is not set")
      }
      return state._me
    },
    isHost(state) {
      return state.isHostOverride !== undefined
        ? state.isHostOverride
        : state._me?.id === state.session.host
    },
    thumbnailUrl(state) {
      const base = state.session.video?.thumbnailUrl
      if (!base) return ""
      const path = new URL(base).pathname
      return `/external/nicovideo--cdn--nimg--jp${path}`
    },
    sessionSetting(state) {
      return {
        ...state.session.setting,
        ...state.settingOverride,
      }
    },

    canQueue(state): boolean {
      return (
        this.isHost ||
        (state.session.queue.length < this.sessionSetting.queueLimit &&
          !this.sessionSetting.queueLocked)
      )
    },
    isPaused(state): boolean {
      return state.session.pausedAt !== null
    },
    isPausedEffective(state): boolean {
      return state.pausedOverride?.paused ?? state.session.pausedAt !== null
    },
    canControl(): boolean {
      return this.isHost || this.sessionSetting.controlShared
    },
    // 動画先頭からの再生位置（ミリ秒）を返す関数を返す。負値はバッファ待機中
    rawPosition(state) {
      return (now: number): number => {
        const nonce = state.session.video?.nonce
        const paused =
          state.pausedOverride?.paused ?? state.session.pausedAt !== null
        if (state.seekOverride && state.seekOverride.nonce === nonce) {
          const override = state.seekOverride
          return paused ? override.time : override.time + (now - override.at)
        }
        if (state.pausedOverride && state.pausedOverride.nonce === nonce) {
          const override = state.pausedOverride
          return override.paused
            ? override.position
            : override.position + (now - override.at)
        }
        return (
          (state.session.pausedAt ?? now) -
          state.session.startedAt -
          buffer +
          state.delay
        )
      }
    },
  },
  actions: {
    async setToken(token: string) {
      this._token = token
    },
    async setSession(session: Session) {
      this.session = session
    },
    async setMemberStates(memberState: Record<string, MemberState>) {
      this.memberStates = memberState
    },
    async panic() {
      this.setView("error")
    },
    setView(view: "login" | "main" | "error") {
      this.view = view
    },
    setMe(me: Participant) {
      this._me = me
    },
    setParticipants(participants: Participant[]) {
      this.participants = participants
      const allParticipantIds = new Set(this.allParticipants.map((p) => p.id))
      for (const participant of participants) {
        if (!allParticipantIds.has(participant.id)) {
          this.allParticipants.push(participant)
        }
      }
    },

    getUser(id: string) {
      return this.allParticipants.find((p) => p.id === id)
    },
    getAvatarUrl(id: string) {
      const user = this.getUser(id)
      if (!user) return "https://cdn.discordapp.com/embed/avatars/0.png"
      if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      } else {
        return `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`
      }
    },
    getName(id: string) {
      const user = this.getUser(id)
      if (!user) return "Unknown"
      return user.nickname || user.global_name || user.username || "Unknown"
    },

    resetIsHostOverride() {
      this.isHostOverride = undefined
    },
    setIsHostOverride(isHost: boolean) {
      this.isHostOverride = isHost
    },
    resetStateOverride() {
      this.stateOverride = {}
    },
    setStateOverride(state: Partial<MemberState>) {
      this.stateOverride = {
        ...this.stateOverride,
        ...state,
      }
      this.stateOverrideUpdatedAt = Date.now()
    },
    setDebug(debug: boolean) {
      this.debug = debug
    },
    setDelay(delay: number) {
      this.delay = delay
    },
    setSettingOverride(setting: Partial<SessionSetting>) {
      this.settingOverride = {
        ...this.settingOverride,
        ...setting,
      }
    },
    resetSettingOverride() {
      this.settingOverride = {}
    },
    setPausedOverride(paused: boolean) {
      const at = Date.now()
      this.pausedOverride = {
        nonce: this.session.video?.nonce ?? "",
        paused,
        at,
        position: this.rawPosition(at),
      }
      // 凍結位置に吸収されたのでシークのオーバーライドは破棄する
      this.seekOverride = undefined
    },
    setSeekOverride(time: number) {
      this.seekOverride = {
        nonce: this.session.video?.nonce ?? "",
        at: Date.now(),
        time,
      }
    },
    // 同期結果がオーバーライドを反映していたら（または別動画に変わっていたら）破棄する
    reconcilePlaybackOverrides() {
      const nonce = this.session.video?.nonce
      if (this.pausedOverride) {
        const matches =
          (this.session.pausedAt !== null) === this.pausedOverride.paused
        if (this.pausedOverride.nonce !== nonce || matches) {
          this.pausedOverride = undefined
        }
      }
      if (this.seekOverride) {
        const override = this.seekOverride
        const paused =
          this.pausedOverride?.paused ?? this.session.pausedAt !== null
        const sessionPos =
          (this.session.pausedAt ?? Date.now()) -
          this.session.startedAt -
          buffer
        const overridePos = paused
          ? override.time
          : override.time + (Date.now() - override.at)
        if (
          override.nonce !== nonce ||
          Math.abs(sessionPos - overridePos) < 2500
        ) {
          this.seekOverride = undefined
        }
      }
    },
  },
})
