<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import Landing from './components/Landing.vue'
import Core from './components/Core.vue'
import PointerOverlay from './components/PointerOverlay.vue'

type CurtainPhase = 'idle' | 'hold' | 'fade'
const CURTAIN_FADE_DELAY = 0 // 无延迟
const CURTAIN_FADE_DURATION = 250 // 0.25秒完成白色窗帘过渡

const showNextSection = ref(false)
const curtainPhase = ref<CurtainPhase>('idle')
const curtainSkipTransition = ref(false)
let curtainTimer: number | undefined

// Avatar 加载进度
const avatarProgress = ref(0)

// Core 组件引用
const coreRef = ref<InstanceType<typeof Core> | null>(null)

const handleAvatarLoading = (progress: number) => {
    avatarProgress.value = progress
}

const handleAvatarReady = () => {
    console.log('Avatar ready, triggering Landing complete')
}

const handleLandingComplete = () => {
    curtainSkipTransition.value = true
    curtainPhase.value = 'hold'
    showNextSection.value = true
    if (curtainTimer) {
        window.clearTimeout(curtainTimer)
    }
    curtainTimer = window.setTimeout(() => {
        curtainSkipTransition.value = false
        curtainPhase.value = 'fade'
    }, CURTAIN_FADE_DELAY)
}

const handleCurtainTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName !== 'opacity' || event.target !== event.currentTarget) {
        return
    }
    if (curtainPhase.value === 'fade') {
        curtainPhase.value = 'idle'
        // 窗帘动画结束后，恢复 Avatar 的渲染
        if (coreRef.value && coreRef.value.getAvatar()) {
            coreRef.value.getAvatar()?.resume()
        }
    }
}

// 监听 showNextSection 变化，当 Landing 消失时恢复 Avatar 渲染
watch(showNextSection, (value) => {
    if (value && coreRef.value && coreRef.value.getAvatar()) {
        // Landing 消失，恢复 Avatar 渲染
        coreRef.value.getAvatar()?.resume()
    }
})

onBeforeUnmount(() => {
    if (curtainTimer) {
        window.clearTimeout(curtainTimer)
    }
})
</script>

<template>
    <div class="app-root">
        <!-- Core 始终渲染，为了加载 Avatar -->
        <Core
            ref="coreRef"
            v-show="true"
            @loading="handleAvatarLoading"
            @ready="handleAvatarReady"
        />

        <!-- Landing 遮罩层，加载完成后消失 -->
        <Transition name="landing-fade">
            <Landing
                v-if="!showNextSection"
                :external-progress="avatarProgress"
                @complete="handleLandingComplete"
            />
        </Transition>

        <PointerOverlay />

        <div
            class="white-curtain"
            :class="{
                'white-curtain--hold': curtainPhase === 'hold',
                'white-curtain--fade': curtainPhase === 'fade',
                'white-curtain--no-transition': curtainSkipTransition,
            }"
            :style="{ '--curtain-duration': `${CURTAIN_FADE_DURATION}ms` }"
            @transitionend="handleCurtainTransitionEnd"
        ></div>
    </div>
</template>

<style scoped>
:global(html, body, #app) {
    cursor: none;
}

.app-root {
    position: relative;
}

.white-curtain {
    position: fixed;
    inset: 0;
    background: #fff;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--curtain-duration, 1.4s) cubic-bezier(0.2, 0.8, 0.2, 1);
    z-index: 30;
}

.white-curtain--hold {
    opacity: 1;
}

.white-curtain--fade {
    opacity: 0;
}

.white-curtain--no-transition {
    transition: none !important;
}

/* Landing 淡出过渡 */
.landing-fade-enter-active,
.landing-fade-leave-active {
    transition: opacity 0.25s ease-out;
}

.landing-fade-enter-from,
.landing-fade-leave-to {
    opacity: 0;
}

.landing-fade-enter-to,
.landing-fade-leave-from {
    opacity: 1;
}
</style>
