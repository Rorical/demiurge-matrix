window.AudioContext = window.AudioContext || (window as any).webkitAudioContext

/**
 * Lipsync 口型同步
 * @event ready AudioWorkletNode加载完成
 * @event loaded 音频加载完成
 * @event play 音频开始播放
 * @event ended 音频结束播放
 */
export default class Lipsync extends EventTarget {
    static SAMPLING_FREQUENCY: number = 44100
    static VOICE_BOUNDING_FREQUENCIES: number[] = [0, 500, 700, 3000, 6000]
    static AUDIO_SAMPLE_COUNT = { low: 256, med: 512, high: 1024 }
    static SAMPLE_COUNT: number = Lipsync.AUDIO_SAMPLE_COUNT.high
    static SMOOTHING: number = 0.25 // range [0,1]
    static SENSITIVITY_THRESHOLD: number = 0.43 // range [-.5, .5]

    private readonly AUDIO_CONTEXT: AudioContext = new AudioContext()

    private _analyser: AnalyserNode
    private _node: AudioWorkletNode | ScriptProcessorNode | null
    private _source: AudioBufferSourceNode | null
    private _buffer: AudioBuffer | null
    private _isPlaying: boolean
    private _isProcessorReady: boolean
    private _blendShapes: {
        blendShapeKiss: number
        blendShapeLips: number
        blendShapeMouth: number
    }
    private _indicesFrequency: number[]
    private _debug: boolean
    private _useAudioWorklet: boolean

    constructor(
        { debug = false } = {
            debug: false,
        }
    ) {
        super()
        this._analyser = this.AUDIO_CONTEXT.createAnalyser()
        this._analyser.minDecibels = -160
        this._analyser.maxDecibels = -25
        this._analyser.smoothingTimeConstant = Lipsync.SMOOTHING
        this._analyser.fftSize = Lipsync.SAMPLE_COUNT

        this._node = null
        this._isProcessorReady = false
        this.initProcessor().catch(err => {
            console.error('Failed to initialize audio processor:', err)
        })

        this._source = null
        this._buffer = null

        this._isPlaying = false
        this._blendShapes = {
            blendShapeKiss: 0,
            blendShapeLips: 0,
            blendShapeMouth: 0,
        }
        this._indicesFrequency = []
        this._debug = debug
        this._useAudioWorklet = false
    }

    /**
     * 从url加载音频
     * @param url 音频url
     */
    async loadFromUrl(url: string) {
        this._buffer = await this._getData(url)
        this.dispatchEvent(new Event('loaded'))
    }

    /**
     * 播放音频
     */
    play() {
        this._log('Buffer play.')

        if (!this.isReady) {
            throw new Error('Lipsync is not ready.')
        }

        if (this._isPlaying) {
            throw new Error('Lipsync is already playing.')
        }

        this._isPlaying = true

        for (let m = 0; m < Lipsync.VOICE_BOUNDING_FREQUENCIES.length; m++) {
            this._indicesFrequency[m] = Math.round(
                ((2 * Lipsync.SAMPLE_COUNT) / Lipsync.SAMPLING_FREQUENCY) *
                    Lipsync.VOICE_BOUNDING_FREQUENCIES[m]
            )
        }

        this._source = this.AUDIO_CONTEXT.createBufferSource()
        this._source.connect(this._analyser)
        this._source.connect(this.AUDIO_CONTEXT.destination)
        this._source.onended = this._ended
        this._source.buffer = this._buffer

        // 使用 ScriptProcessorNode 作为 fallback
        if (!this._useAudioWorklet) {
            this._node = this.AUDIO_CONTEXT.createScriptProcessor(
                Lipsync.SAMPLE_COUNT * 2,
                1,
                1
            ) as ScriptProcessorNode
            this._analyser.connect(this._node)
            this._node.connect(this.AUDIO_CONTEXT.destination)
            ;(this._node as ScriptProcessorNode).onaudioprocess = () => {
                this._processAudio()
            }
        }

        this._source.start(0)
        this.dispatchEvent(new Event('play'))
    }

    /**
     * 暂停音频
     */
    stop() {
        this._log('stop')

        if (!this._source || !this._isPlaying) {
            return
        }

        this._source.stop()

        // 断开 ScriptProcessorNode 连接以避免内存泄漏
        if (!this._useAudioWorklet && this._node) {
            this._node.disconnect()
            ;(this._node as ScriptProcessorNode).onaudioprocess = null
        }
    }

    /**
     * 获取是否准备好（处理器已初始化且音频已加载）
     * @returns 是否准备好
     */
    get isReady() {
        return this._isProcessorReady && this._buffer !== null
    }

    /**
     * 获取处理器是否已初始化
     * @returns 处理器是否已初始化
     */
    get isProcessorReady() {
        return this._isProcessorReady
    }

    /**
     * 获取音频是否已加载
     * @returns 音频是否已加载
     */
    get isAudioLoaded() {
        return this._buffer !== null
    }

    /**
     * 获取是否正在播放
     * @returns 是否正在播放
     */
    get isPlaying() {
        return this._isPlaying
    }

    /**
     * 获取blendShapes
     * @returns blendShapes
     */
    get blendShapes() {
        return this._blendShapes
    }

    private initProcessor() {
        // 检查 audioWorklet 是否可用
        if (!this.AUDIO_CONTEXT.audioWorklet) {
            this._log('AudioWorklet not supported, using ScriptProcessorNode as fallback.')
            this._useAudioWorklet = false
            this._isProcessorReady = true
            this.dispatchEvent(new Event('ready'))
            return Promise.resolve()
        }

        this._useAudioWorklet = true
        return this.AUDIO_CONTEXT.audioWorklet
            .addModule(new URL('@/libs/lipsync/processor.js', import.meta.url))
            .then(() => {
                this._node = new AudioWorkletNode(this.AUDIO_CONTEXT, 'processor')
                this._analyser.connect(this._node)
                this._node.connect(this.AUDIO_CONTEXT.destination)

                this._node.port.onmessage = event => {
                    this._processAudio()
                }

                this._log('Processor ready.')
                this._isProcessorReady = true
                this.dispatchEvent(new Event('ready'))
            })
            .catch(err => {
                this._log('Failed to load AudioWorklet, using ScriptProcessorNode as fallback.')
                console.warn('AudioWorklet initialization failed:', err)
                this._useAudioWorklet = false
                this._isProcessorReady = true
                this.dispatchEvent(new Event('ready'))
            })
    }

    private _getData(url: string): Promise<AudioBuffer> {
        var request = new XMLHttpRequest()

        request.open('GET', url, true)
        request.responseType = 'arraybuffer'

        return new Promise((resolve, reject) => {
            request.onload = () => {
                var audioData = request.response

                this.AUDIO_CONTEXT.decodeAudioData(
                    audioData,
                    (_buffer: AudioBuffer) => {
                        this._log('Buffer ready to play.')

                        resolve(_buffer)
                    },
                    err => {
                        this._log('Error with decoding audio data:' + err)
                        reject(err)
                    }
                )
            }

            request.send()
        })
    }

    private _ended = (event: Event) => {
        this._log('ended')
        this._isPlaying = false
        this.dispatchEvent(new Event('ended'))
    }

    private _processAudio() {
        const spectrum = new Float32Array(this._analyser.frequencyBinCount)
        this._analyser.getFloatFrequencyData(spectrum)
        const _stPSD: Float32Array = this._getStPSD(spectrum)

        let _blendShapeKiss = 0
        let _blendShapeLips = 0
        let _blendShapeMouth = 0

        let energyBin = new Float32Array(Lipsync.VOICE_BOUNDING_FREQUENCIES.length)

        for (let m = 0; m < Lipsync.VOICE_BOUNDING_FREQUENCIES.length - 1; m++) {
            for (let j = this._indicesFrequency[m]; j <= this._indicesFrequency[m + 1]; j++) {
                if (_stPSD[j] > 0) {
                    energyBin[m] += _stPSD[j]
                }
            }

            energyBin[m] /= this._indicesFrequency[m + 1] - this._indicesFrequency[m]
        }

        if (energyBin[1] > 0.2) {
            _blendShapeKiss = 1 - 2 * energyBin[2]
        } else {
            _blendShapeKiss = (1 - 2 * energyBin[2]) * 5 * energyBin[1]
        }

        _blendShapeLips = 3 * energyBin[3]
        _blendShapeMouth = 0.8 * (energyBin[1] - energyBin[3])

        this._blendShapes = {
            blendShapeKiss: _blendShapeKiss * 1.5,
            blendShapeLips: _blendShapeLips * 1.5,
            blendShapeMouth: _blendShapeMouth * 1.5,
        }
    }

    private _getRMS(spectrum: Float32Array) {
        let rms = 0
        for (let i = 0; i < spectrum.length; i++) {
            rms += spectrum[i] * spectrum[i]
        }
        rms /= spectrum.length
        rms = Math.sqrt(rms)
        return rms
    }

    private _getStPSD(spectrum: Float32Array) {
        const stPSD = new Float32Array(spectrum.length)

        for (let i = 0; i < spectrum.length; i++) {
            stPSD[i] = Lipsync.SENSITIVITY_THRESHOLD + (spectrum[i] + 20) / 140
        }

        return stPSD
    }

    private _log(message: string) {
        if (this._debug) console.log(message)
    }
}
