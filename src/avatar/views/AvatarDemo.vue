<script setup lang="ts">
/**
 * AvatarDemo - Avatar 组件使用示例
 * 
 * 这是一个简单的示例，展示如何使用 Avatar 组件
 * 你可以基于此创建自己的页面
 */
import { ref } from 'vue'
import Avatar from '@/avatar/components/Avatar.vue'

// 组件引用
const avatarRef = ref<InstanceType<typeof Avatar>>()

// 状态管理
const isLoading = ref(true)
const loadingProgress = ref(0)
const errorMessage = ref('')
const showControls = ref(false)

// 事件处理
const handleLoading = (progress: number) => {
  loadingProgress.value = progress
}

const handleLoaded = () => {
  isLoading.value = false
  showControls.value = true
}

const handleError = (error: Error) => {
  isLoading.value = false
  errorMessage.value = error.message
}

const handleVrmLoaded = (vrm: any) => {
  console.log('VRM loaded:', vrm)
}

const handleReady = () => {
  console.log('Avatar ready!')
}

// 控制方法
const pauseRendering = () => {
  avatarRef.value?.pause()
}

const resumeRendering = () => {
  avatarRef.value?.resume()
}

const forceUpdate = () => {
  avatarRef.value?.forceBackgroundUpdate()
}
</script>

<template>
  <div class="demo-container">
    <!-- Avatar 组件 -->
    <Avatar 
      ref="avatarRef"
      :show-fps="false"
      :show-loading-progress="false"
      @loading="handleLoading"
      @loaded="handleLoaded"
      @error="handleError"
      @vrm-loaded="handleVrmLoaded"
      @ready="handleReady"
    />
    
    <!-- 自定义加载界面 -->
    <div v-if="isLoading" class="custom-loading">
      <div class="loading-content">
        <div class="spinner"></div>
        <p class="loading-text">加载中...</p>
        <p class="loading-progress">{{ Math.round(loadingProgress) }}%</p>
      </div>
    </div>
    
    <!-- 错误提示 -->
    <div v-if="errorMessage" class="error-message">
      <p>❌ {{ errorMessage }}</p>
    </div>
    
    <!-- 控制面板 -->
    <div v-if="showControls" class="control-panel">
      <button @click="pauseRendering" class="control-btn">暂停</button>
      <button @click="resumeRendering" class="control-btn">恢复</button>
      <button @click="forceUpdate" class="control-btn">刷新背景</button>
    </div>
  </div>
</template>

<style scoped>
.demo-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* 自定义加载界面 */
.custom-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  z-index: 100;
}

.loading-content {
  text-align: center;
  color: white;
}

.spinner {
  width: 60px;
  height: 60px;
  margin: 0 auto 1rem;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.loading-progress {
  font-size: 1rem;
  opacity: 0.8;
}

/* 错误提示 */
.error-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 2rem;
  background: rgba(220, 38, 38, 0.95);
  color: white;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  max-width: 90%;
  text-align: center;
  z-index: 100;
}

/* 控制面板 */
.control-panel {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.5rem;
  z-index: 10;
}

.control-btn {
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.control-btn:hover {
  background: white;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.control-btn:active {
  transform: translateY(0);
}
</style>
