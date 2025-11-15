/**
 * Preloader Web Worker
 * 在后台线程中加载资源，避免阻塞主线程
 */

export interface WorkerResource {
    name: string
    url: string
    type: 'VRM' | 'VRMA' | 'SPLAT' | 'UNKNOWN'
}

export interface WorkerMessage {
    type: 'INIT' | 'START_LOAD' | 'CANCEL'
    resources?: WorkerResource[]
}

export interface WorkerResponse {
    type: 'PROGRESS' | 'RESOURCE_LOADED' | 'ALL_COMPLETED' | 'ERROR' | 'SIZE_READY'
    progress?: number
    resourceName?: string
    data?: ArrayBuffer
    error?: string
    totalBytes?: number
}

// 资源信息存储
const resourcesInfo = new Map<
    string,
    {
        url: string
        type: string
        size: number
        loaded: number
    }
>()

let totalBytes = 0
let totalLoadedBytes = 0
let lastReportedProgress = 0
let isInitialized = false // 添加初始化标志

/**
 * 获取资源大小
 */
async function getResourceSize(url: string): Promise<number> {
    try {
        const response = await fetch(url, { method: 'HEAD' })
        if (!response.ok) {
            return 0
        }
        const contentLength = response.headers.get('Content-Length')
        return contentLength ? parseInt(contentLength, 10) : 0
    } catch (error) {
        return 0
    }
}

/**
 * 更新进度并发送消息
 */
function updateProgress(delta: number) {
    totalLoadedBytes += delta
    const progress = Math.floor((totalLoadedBytes / totalBytes) * 100)

    // 只在进度变化超过1%时才报告，减少消息传递开销
    if (progress > lastReportedProgress && progress - lastReportedProgress >= 1) {
        lastReportedProgress = progress
        self.postMessage({
            type: 'PROGRESS',
            progress,
        } as WorkerResponse)
    }
}

/**
 * 加载单个资源（fetch 方式）
 */
async function loadResource(name: string, url: string): Promise<void> {
    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body!.getReader()
        const chunks: Uint8Array[] = []
        let loadedBytes = 0

        while (true) {
            const { done, value } = await reader.read()

            if (done) break

            chunks.push(value!)
            const delta = value!.byteLength
            loadedBytes += delta
            updateProgress(delta)

            // 更新该资源的已加载字节数
            const info = resourcesInfo.get(name)
            if (info) {
                info.loaded = loadedBytes
            }
        }

        // 合并 chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const mergedArray = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
            mergedArray.set(chunk, offset)
            offset += chunk.length
        }

        // 发送加载完成的资源
        const buffer = mergedArray.buffer
        self.postMessage(
            {
                type: 'RESOURCE_LOADED',
                resourceName: name,
                data: buffer,
            } as WorkerResponse,
            { transfer: [buffer] } // 转移所有权，避免复制
        )
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            resourceName: name,
            error: error instanceof Error ? error.message : String(error),
        } as WorkerResponse)
        throw error
    }
}

/**
 * 初始化资源信息
 */
async function initResources(resources: WorkerResource[]) {
    resourcesInfo.clear()
    totalBytes = 0
    totalLoadedBytes = 0
    lastReportedProgress = 0
    isInitialized = false // 重置初始化标志

    // 获取所有资源的大小
    const sizePromises = resources.map(async resource => {
        const size = await getResourceSize(resource.url)
        resourcesInfo.set(resource.name, {
            url: resource.url,
            type: resource.type,
            size,
            loaded: 0,
        })
        return size
    })

    const sizes = await Promise.all(sizePromises)
    totalBytes = sizes.reduce((sum, size) => sum + size, 0)

    // 标记初始化完成
    isInitialized = true

    // 通知主线程总大小已准备好
    self.postMessage({
        type: 'SIZE_READY',
        totalBytes,
    } as WorkerResponse)
}

/**
 * 开始加载所有资源
 */
async function startLoading() {
    // 检查初始化状态
    if (!isInitialized) {
        self.postMessage({
            type: 'ERROR',
            error: 'Worker not initialized',
        } as WorkerResponse)
        return
    }

    const loadPromises: Promise<void>[] = []

    for (const [name, info] of resourcesInfo.entries()) {
        loadPromises.push(loadResource(name, info.url))
    }

    try {
        await Promise.all(loadPromises)

        // 所有资源加载完成
        self.postMessage({
            type: 'ALL_COMPLETED',
            progress: 100,
        } as WorkerResponse)
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error instanceof Error ? error.message : String(error),
        } as WorkerResponse)
    }
}

/**
 * 处理主线程消息
 */
self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
    const { type, resources } = event.data

    switch (type) {
        case 'INIT':
            if (resources) {
                await initResources(resources)
            }
            break

        case 'START_LOAD':
            await startLoading()
            break

        case 'CANCEL':
            // 取消加载（可以添加取消逻辑）
            self.postMessage({
                type: 'ERROR',
                error: 'Load cancelled',
            } as WorkerResponse)
            break
    }
})

// 导出类型（用于主线程）
export type {}
