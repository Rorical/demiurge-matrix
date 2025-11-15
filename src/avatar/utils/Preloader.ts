import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export enum PreloadResourceType {
    VRM = 'VRM',
    VRMA = 'VRMA',
    SPLAT = 'SPLAT',
    UNKNOWN = 'UNKNOWN',
}

export enum PreloaderStatus {
    PENDING = 'pending',
    LOADING = 'loading',
    COMPLETED = 'completed',
    ERROR = 'error',
}

export enum PreloaderEvent {
    PROGRESS = 'progress',
    COMPLETED = 'completed',
    ERROR = 'error',
}

export class PreloadResource {
    private name: string
    private url: string
    private type: PreloadResourceType
    private size: number = 0
    private sizeRetriver: Promise<void>
    private data: any

    constructor(url: string, name?: string) {
        this.url = url

        // 获取资源名称
        if (!name) {
            this.name = this.url.split('/').pop() ?? ''
        } else {
            this.name = name
        }

        // 获取资源大小
        this.sizeRetriver = fetch(this.url, {
            method: 'HEAD',
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('资源加载失败')
                }

                let contentLength = response.headers.get('Content-Length')
                if (contentLength && !isNaN(parseInt(contentLength))) {
                    this.size = parseInt(contentLength)
                }
            })
            .catch(error => {
                console.error(error)
                throw new Error('资源加载失败')
            })

        // 判断资源类型
        let extension = this.url.split('.').pop()?.toLowerCase() ?? ''
        switch (extension) {
            case 'vrm':
                this.type = PreloadResourceType.VRM
                break
            case 'vrma':
                this.type = PreloadResourceType.VRMA
                break
            case 'splat':
            case 'ply':
            case 'ksplat':
                this.type = PreloadResourceType.SPLAT
                break
            default:
                this.type = PreloadResourceType.UNKNOWN
                break
        }
    }

    getName() {
        return this.name
    }

    getUrl() {
        return this.url
    }

    getType() {
        return this.type
    }

    getSize() {
        return this.size
    }

    getSizeRetriver() {
        return this.sizeRetriver
    }

    getData() {
        return this.data
    }

    setData(data: any) {
        this.data = data
    }
}

export class Preloader {
    private resources: PreloadResource[]
    private resourcesMap: Map<string, number>
    private promises: Promise<void>[]
    private status: string
    private progress: number
    private totalBytes: number
    private loadedBytes: number
    private gltfLoader: GLTFLoader | null
    private listeners: any

    constructor() {
        this.resources = []
        this.resourcesMap = new Map()
        this.promises = []
        this.status = PreloaderStatus.PENDING
        this.progress = 0
        this.totalBytes = 0
        this.loadedBytes = 0
        this.gltfLoader = null
        this.listeners = {
            progress: [],
            completed: [],
            error: [],
        }

        // resources绑定get方法
        Object.defineProperty(this.resources, 'getByName', {
            value: this.getResource.bind(this),
            writable: false,
            enumerable: false,
            configurable: true,
        })
    }

    // 添加资源
    add(resource: PreloadResource) {
        this.resources.push(resource)
        this.resourcesMap.set(resource.getName(), this.resources.length - 1)
    }

    // 添加监听器
    on(type: string, listener: any) {
        if (this.listeners[type]) {
            this.listeners[type].push(listener)
        } else {
            throw new Error('无效事件类型')
        }
    }

    // 挂载GLTFLoader
    bindGLTFLoader(gltfLoader: GLTFLoader) {
        if (this.gltfLoader) {
            throw new Error('已挂载GLTFLoader')
        }

        this.gltfLoader = gltfLoader
    }

    private updateProgress(delta: number) {
        this.loadedBytes += delta

        // 计算进度
        let progress = Math.floor((this.loadedBytes / this.totalBytes) * 100)

        if (progress > this.progress) {
            this.progress = progress

            // 触发事件
            this.dispatchEvent({
                type: PreloaderEvent.PROGRESS,
                progress: progress,
            })
        }

        return progress
    }

    private dispatchEvent(event: any) {
        switch (event.type) {
            case PreloaderEvent.PROGRESS:
                this.listeners.progress.forEach((listener: any) => {
                    listener(event.progress)
                })
                break
            case PreloaderEvent.COMPLETED:
                this.listeners.completed.forEach((listener: any) => {
                    listener(this.resources)
                })
                break
            case PreloaderEvent.ERROR:
                this.listeners.error.forEach((listener: any) => {
                    listener(event.error)
                })
                break
            default:
                throw new Error('无效事件类型')
        }
    }

    // 开始加载
    async load() {
        // 检查是否已经开始加载
        if (this.status !== PreloaderStatus.PENDING) {
            throw new Error('Preloader状态错误')
        }

        // 等待资源大小获取完成
        await Promise.all(this.resources.map(resource => resource.getSizeRetriver())).catch(
            error => {
                console.error('资源大小获取失败', error)
                throw error
            }
        )

        // 更新totalBytes
        this.totalBytes = this.resources.reduce((total, resource) => total + resource.getSize(), 0)

        // 更新状态
        this.status = PreloaderStatus.LOADING

        // 批量创建Promise
        this.resources.forEach(resource => {
            switch (resource.getType()) {
                case PreloadResourceType.VRM:
                    this.promises.push(this.loadGLTF(resource))
                    break

                case PreloadResourceType.VRMA:
                    this.promises.push(this.loadGLTF(resource))
                    break

                case PreloadResourceType.SPLAT:
                    this.promises.push(this.loadSplat(resource))
                    break

                default:
                    this.promises.push(this.loadUnknown(resource))
                    break
            }
        })

        // 等待所有资源加载完成
        await Promise.all(this.promises).catch(error => {
            console.error('资源加载失败', error)
            throw error
        })

        // 更新状态
        this.status = PreloaderStatus.COMPLETED

        // 触发事件
        this.dispatchEvent({
            type: 'completed',
        })
    }

    private loadGLTF(resource: PreloadResource): Promise<void> {
        return new Promise((resolve, reject) => {
            let loadedBytes = 0
            if (!this.gltfLoader) {
                const error = new Error('GLTFLoader未挂载')
                console.error(error)
                reject(error)
                this.dispatchEvent({
                    type: PreloaderEvent.ERROR,
                    error: error,
                })
                return
            }
            this.gltfLoader.load(
                // VRM文件URL
                resource.getUrl(),

                // 加载完成回调
                (gltf: any) => {
                    resource.setData(gltf)
                    resolve()
                },

                // 加载进度回调
                (xhr: any) => {
                    let delta = xhr.loaded - loadedBytes
                    loadedBytes = xhr.loaded
                    this.updateProgress(delta)
                },

                // 加载失败回调
                (error: unknown) => {
                    const err = error instanceof Error ? error : new Error(String(error))
                    console.error(err)
                    reject(err)
                    this.dispatchEvent({
                        type: PreloaderEvent.ERROR,
                        error: err,
                    })
                }
            )
        })
    }

    private loadSplat(resource: PreloadResource): Promise<void> {
        return new Promise((resolve, reject) => {
            fetch(resource.getUrl())
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`)
                    }
                    return response.body
                })
                .then(async body => {
                    const reader = body!.getReader()
                    const chunks: Uint8Array[] = []

                    while (true) {
                        const { done, value } = await reader.read()

                        if (done) break

                        let delta = value!.byteLength
                        this.updateProgress(delta)

                        chunks.push(value!)
                    }

                    // 将 chunks 合并为一个 ArrayBuffer
                    let totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
                    let mergedArray = new Uint8Array(totalLength)
                    let offset = 0
                    for (let chunk of chunks) {
                        mergedArray.set(chunk, offset)
                        offset += chunk.length
                    }

                    // 保存为 ArrayBuffer
                    resource.setData(mergedArray.buffer)
                    resolve()
                })
                .catch(error => {
                    console.error('Splat文件加载失败', error)
                    reject(error)
                    this.dispatchEvent({
                        type: PreloaderEvent.ERROR,
                        error: error,
                    })
                })
        })
    }

    private loadUnknown(resource: PreloadResource): Promise<void> {
        return new Promise((resolve, reject) => {
            fetch(resource.getUrl())
                .then(response => response!.body)
                .then(async body => {
                    const reader = body!.getReader()
                    const chunks: Uint8Array[] = []

                    while (true) {
                        const { done, value } = await reader.read()

                        if (done) break

                        let delta = value!.byteLength
                        this.updateProgress(delta)

                        chunks.push(value!)
                    }

                    let totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
                    let mergedArray = new Uint8Array(totalLength)
                    let offset = 0
                    for (let chunk of chunks) {
                        mergedArray.set(chunk, offset)
                        offset += chunk.length
                    }

                    let data = mergedArray.buffer
                    resource.setData(data)

                    resolve()
                })
                .catch(error => {
                    console.error('资源加载失败', error)
                    reject()
                    this.dispatchEvent({
                        type: PreloaderEvent.ERROR,
                        error: error,
                    })
                    throw new Error('资源加载失败')
                })
        })
    }

    // 获取资源
    getResources() {
        return this.resources
    }

    // 获取指定资源
    getResource(name: string) {
        let index = this.resourcesMap.get(name)
        return index !== undefined ? this.resources[index] : null
    }
}
