/**
 * 背景音乐控制器
 * 处理音乐的淡入淡出和切换
 */

export class BackgroundMusicController {
    private audio: HTMLAudioElement | null = null
    private targetVolume = 0.5 // 目标音量（0-1）
    private fadeInterval: number | null = null
    private isInitialized = false
    private currentPlayPromise: Promise<void> | null = null

    constructor(defaultVolume = 0.5) {
        this.targetVolume = defaultVolume
    }

    /**
     * 初始化音频元素
     */
    private ensureAudio(): HTMLAudioElement {
        if (!this.audio) {
            this.audio = new Audio()
            this.audio.loop = true
            this.audio.volume = 0
        }
        return this.audio
    }

    /**
     * 加载音频
     */
    async load(src: string): Promise<void> {
        const audio = this.ensureAudio()
        
        // 如果已经是同一个音频源，不重新加载
        if (audio.src.endsWith(src)) {
            return
        }

        // 等待之前的播放操作完成
        if (this.currentPlayPromise) {
            try {
                await this.currentPlayPromise
            } catch (error) {
                // 忽略之前播放的错误
            }
            this.currentPlayPromise = null
        }

        // 先暂停当前播放
        if (!audio.paused) {
            audio.pause()
        }

        audio.src = src
        
        try {
            await audio.load()
        } catch (error) {
            console.warn('Failed to load audio:', error)
        }
    }

    /**
     * 尝试播放音频（处理自动播放限制）
     */
    async tryPlay(): Promise<boolean> {
        if (!this.audio) return false

        // 等待之前的播放操作完成
        if (this.currentPlayPromise) {
            try {
                await this.currentPlayPromise
            } catch (error) {
                // 忽略之前播放的错误
            }
        }

        try {
            this.currentPlayPromise = this.audio.play()
            await this.currentPlayPromise
            this.currentPlayPromise = null
            this.isInitialized = true
            return true
        } catch (error) {
            this.currentPlayPromise = null
            if (error instanceof Error && error.name === 'NotAllowedError') {
                console.warn('Autoplay blocked, waiting for user interaction')
                return false
            }
            console.warn('Failed to play audio:', error)
            return false
        }
    }

    /**
     * 淡入播放
     */
    async fadeIn(duration = 1000): Promise<void> {
        this.stopFade()
        
        const audio = this.ensureAudio()
        
        if (audio.paused) {
            audio.volume = 0
            const played = await this.tryPlay()
            if (!played) return
        }

        return new Promise((resolve) => {
            const startVolume = audio.volume
            const volumeStep = (this.targetVolume - startVolume) / (duration / 50)
            
            this.fadeInterval = window.setInterval(() => {
                if (!this.audio) {
                    this.stopFade()
                    resolve()
                    return
                }

                const newVolume = Math.min(this.audio.volume + volumeStep, this.targetVolume)
                this.audio.volume = newVolume

                if (newVolume >= this.targetVolume) {
                    this.stopFade()
                    resolve()
                }
            }, 50)
        })
    }

    /**
     * 淡出停止
     */
    async fadeOut(duration = 1000): Promise<void> {
        this.stopFade()
        
        if (!this.audio || this.audio.paused) return

        return new Promise((resolve) => {
            const startVolume = this.audio!.volume
            const volumeStep = startVolume / (duration / 50)
            
            this.fadeInterval = window.setInterval(() => {
                if (!this.audio) {
                    this.stopFade()
                    resolve()
                    return
                }

                const newVolume = Math.max(this.audio.volume - volumeStep, 0)
                this.audio.volume = newVolume

                if (newVolume <= 0) {
                    this.audio.pause()
                    this.stopFade()
                    resolve()
                }
            }, 50)
        })
    }

    /**
     * 切换音乐（淡出旧的，淡入新的）
     */
    async crossfade(newSrc: string, fadeOutDuration = 1000, fadeInDuration = 1500): Promise<void> {
        // 淡出当前音乐
        await this.fadeOut(fadeOutDuration)
        
        // 加载并淡入新音乐
        await this.load(newSrc)
        await this.fadeIn(fadeInDuration)
    }

    /**
     * 停止淡入淡出动画
     */
    private stopFade(): void {
        if (this.fadeInterval !== null) {
            window.clearInterval(this.fadeInterval)
            this.fadeInterval = null
        }
    }

    /**
     * 设置目标音量
     */
    setVolume(volume: number): void {
        this.targetVolume = Math.max(0, Math.min(1, volume))
        if (this.audio && !this.fadeInterval) {
            this.audio.volume = this.targetVolume
        }
    }

    /**
     * 立即停止播放
     */
    async stop(): Promise<void> {
        this.stopFade()
        
        // 等待之前的播放操作完成
        if (this.currentPlayPromise) {
            try {
                await this.currentPlayPromise
            } catch (error) {
                // 忽略之前播放的错误
            }
            this.currentPlayPromise = null
        }
        
        if (this.audio) {
            this.audio.pause()
            this.audio.currentTime = 0
            this.audio.volume = 0
        }
    }

    /**
     * 获取是否已初始化（用户已交互）
     */
    getIsInitialized(): boolean {
        return this.isInitialized
    }

    /**
     * 销毁音频元素
     */
    async destroy(): Promise<void> {
        await this.stop()
        if (this.audio) {
            this.audio.src = ''
            this.audio = null
        }
    }
}
